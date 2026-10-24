"""HTTPS pull queue: only the local worker talks to Ollama; no inbound PC port."""

import os
import secrets
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_, select, update

from .auth import digest, require
from .content import audit
from .db import get_db
from .duplicates import ensure_unique, find_duplicates
from .languages import languages
from .models import AiJob, AiWorker, Category, now
from .schemas import PoiInput, WikipediaImportInput
from .wikipedia import get_article

router = APIRouter(prefix="/api/v1")
staff = require("editor", "reviewer", "admin")
LEASE_SECONDS = 900


def worker_mode():
    return os.getenv("AI_MODE", "worker" if os.getenv("APP_ENV") == "production" else "direct") == "worker"


def worker_auth(authorization: str = Header(default=""), db=Depends(get_db)):
    expected = os.getenv("AI_WORKER_TOKEN", "")
    worker = db.get(AiWorker, "local") if not expected else None
    paired_hash = worker.token_hash if worker else None
    if len(expected) < 32 and not paired_hash:
        raise HTTPException(503, "Chưa cấu hình khóa kết nối máy AI.")
    valid = secrets.compare_digest(authorization, "Bearer " + expected) if expected else (
        authorization.startswith("Bearer ") and secrets.compare_digest(digest(authorization[7:]), paired_hash)
    )
    if not valid:
        raise HTTPException(401, "Khóa kết nối máy AI không hợp lệ.")


class WorkerPairing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=200)


@router.post("/admin/ai/worker-key")
def pair_worker(data: WorkerPairing, db=Depends(get_db), user=Depends(require("admin"))):
    if os.getenv("AI_WORKER_TOKEN"):
        raise HTTPException(409, "Máy chủ đang dùng khóa worker trong Environment; hãy cập nhật khóa ở đó.")
    worker = db.get(AiWorker, "local")
    if not worker:
        worker = AiWorker(id="local", model="Ollama", ready=False)
        db.add(worker)
    worker.token_hash = digest(data.token)
    worker.ready = False
    audit(db, user, None, "ai_worker_pair", "Ghép nối máy AI; khóa cũ đã bị thay thế.")
    db.commit()
    return {"status": "paired"}


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def queue_status(db):
    worker = db.get(AiWorker, "local")
    online = bool(worker and aware(worker.seen_at) > now() - timedelta(seconds=90))
    return {
        "mode": "worker", "ready": bool(online and worker.ready),
        "worker_protocol": worker.protocol if worker else None,
        "model": worker.model if worker else "Ollama",
        "message": ("Máy AI sẵn sàng" if worker.ready else "Model trên máy AI chưa sẵn sàng")
        if online else "Máy AI chưa kết nối. Mở Ollama và chạy trình nhận việc trên máy của bạn.",
    }


def prepare_import(db, data):
    available = languages(db, enabled_only=True)
    requested = set(data.language_codes) | {item.code for item in available if item.required}
    if not requested or not requested.issubset({item.code for item in available}):
        raise HTTPException(422, "Chọn các ngôn ngữ đang được bật để tạo nội dung.")
    # Resolve redirects and the shared Wikidata identity BEFORE any inference.
    from .wikipedia import normalize_wikipedia_url

    try:
        url = normalize_wikipedia_url(data.url)[2]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    matches = find_duplicates(db, source={"url": url})
    if matches:
        return None, matches[0]
    article = get_article(url)
    matches = find_duplicates(db, article["title"], {
        "url": article["url"], "wikidata_id": article["page"].get("pageprops", {}).get("wikibase_item"),
    })
    if matches:
        return None, matches[0]
    categories = [{"id": item.id, "name": item.name} for item in db.scalars(select(Category))]
    if not categories:
        raise HTTPException(409, "Hãy tạo ít nhất một danh mục trước khi nhập địa điểm.")
    return {
        "article": article, "categories": categories,
        "languages": [{"code": item.code, "name": item.native_name}
                      for item in available if item.code in requested],
    }, None


def job_data(job):
    return {"id": job.id, "status": job.status, "result": job.result, "error": job.error}


@router.post("/admin/ai/jobs", status_code=202)
def enqueue(data: WikipediaImportInput, db=Depends(get_db), user=Depends(staff)):
    if not worker_mode():
        raise HTTPException(409, "Máy chủ đang dùng Ollama trực tiếp.")
    active = db.scalar(select(func.count()).select_from(AiJob).where(
        AiJob.requested_by == user.id, AiJob.status.in_(("queued", "running")),
        AiJob.created_at > now() - timedelta(hours=24),
    ))
    if active >= 3:
        raise HTTPException(429, "Bạn đã có 3 yêu cầu AI đang chờ. Hãy chờ hoàn tất trước khi tạo thêm.")
    payload, existing = prepare_import(db, data)
    if existing:
        raise HTTPException(409, f"Địa điểm đã tồn tại: {existing['name']}. Mở địa điểm hiện có để kiểm tra.")
    job = AiJob(requested_by=user.id, payload=payload)
    db.add(job)
    audit(db, user, None, "ai_request", payload["article"]["url"])
    db.commit()
    return job_data(job)


@router.get("/admin/ai/jobs/{job_id}")
def job_status(job_id: str, db=Depends(get_db), user=Depends(staff)):
    job = db.get(AiJob, job_id)
    if not job or (user.role != "admin" and job.requested_by != user.id):
        raise HTTPException(404, "Không tìm thấy yêu cầu AI.")
    expire_jobs(db)
    db.refresh(job)
    return job_data(job)


class Heartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1, max_length=100)
    ready: bool
    protocol: int = Field(default=1, ge=1, le=2)


@router.post("/worker/heartbeat", dependencies=[Depends(worker_auth)])
def heartbeat(data: Heartbeat, db=Depends(get_db)):
    # One configured PC, shared across server instances/restarts.
    worker = db.get(AiWorker, "local")
    if not worker:
        worker = AiWorker(id="local", model=data.model, ready=data.ready)
        db.add(worker)
    worker.model, worker.ready, worker.seen_at = data.model, data.ready, now()
    worker.protocol = data.protocol
    db.commit()
    return {"status": "ok"}


def expire_jobs(db):
    db.execute(update(AiJob).execution_options(synchronize_session=False).where(
        AiJob.status.in_(("queued", "running")),
        or_(AiJob.created_at < now() - timedelta(hours=24),
            and_(AiJob.status == "running", AiJob.lease_until < now(), AiJob.attempts >= 3)),
    ).values(status="failed", error="Yêu cầu hết hạn do máy AI mất kết nối. Hãy tạo lại.", updated_at=now()))
    db.commit()


class ClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol: int = Field(default=1, ge=1, le=2)


@router.post("/worker/claim", dependencies=[Depends(worker_auth)])
def claim(data: ClaimInput, db=Depends(get_db)):
    expire_jobs(db)
    eligible = or_(AiJob.status == "queued", and_(AiJob.status == "running", AiJob.lease_until < now()))
    if data.protocol < 2:
        kind = AiJob.payload["kind"].as_string()
        eligible = and_(eligible, or_(kind.is_(None), kind != "supplement"))
    job_id = db.scalar(select(AiJob.id).where(eligible).order_by(AiJob.created_at).limit(1))
    if not job_id:
        return {"job": None}
    lease = secrets.token_urlsafe(32)
    changed = db.execute(update(AiJob).execution_options(synchronize_session=False).where(AiJob.id == job_id, eligible).values(
        status="running", lease_hash=digest(lease), lease_until=now() + timedelta(seconds=LEASE_SECONDS),
        attempts=AiJob.attempts + 1, updated_at=now(),
    ))
    db.commit()
    if changed.rowcount != 1:
        return {"job": None}
    job = db.get(AiJob, job_id)
    return {"job": {"id": job.id, "lease": lease, "payload": job.payload}}


class Completion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: str = Field(min_length=32, max_length=100)
    draft: PoiInput | None = None
    missing_fields: list[str] = Field(default_factory=list, max_length=10)
    elapsed_seconds: float = Field(default=0, ge=0, le=900)
    error: str = Field(default="", max_length=1000)
    translation: dict | None = None
    model: str = Field(default="", max_length=100)


@router.post("/worker/jobs/{job_id}/complete", dependencies=[Depends(worker_auth)])
def complete(job_id: str, data: Completion, db=Depends(get_db)):
    job = db.get(AiJob, job_id)
    if not job or not secrets.compare_digest(job.lease_hash or "", digest(data.lease)):
        raise HTTPException(409, "Lượt xử lý AI không còn hợp lệ.")
    if job.status in ("completed", "failed"):
        return {"status": job.status}  # Retry after a lost HTTP response is harmless.
    if not job.lease_until or aware(job.lease_until) < now():
        raise HTTPException(409, "Lượt xử lý AI đã hết hạn.")
    result = None
    if data.error:
        # Display only a generic error; never trust/log exceptions containing credentials.
        error = "Máy AI chưa tạo được nội dung. Kiểm tra Ollama rồi thử lại."
    elif job.payload.get("kind") == "supplement":
        from .narration_jobs import quality_issues
        from .schemas import TranslationInput

        try:
            translation = TranslationInput.model_validate(data.translation)
            issues = quality_issues(job.payload["locale"], translation)
        except ValueError:
            issues = ["invalid_schema"]
        error = "AI output needs regeneration or manual correction: " + ", ".join(issues) if issues else ""
        if not error:
            result = {"translation": translation.model_dump(), "locale": job.payload["locale"],
                      "model": data.model, "generated_at": now().isoformat(), "review_required": True,
                      "warnings": ["Verify target language and facts; automatic checks cannot establish accuracy"]}
    else:
        draft, payload = data.draft, job.payload
        if not draft or not draft.source or (
            draft.source.url != payload["article"]["url"]
            or draft.name != payload["article"]["title"]
            or draft.source.wikidata_id != payload["article"]["page"].get("pageprops", {}).get("wikibase_item")
            or draft.category_id not in {item["id"] for item in payload["categories"]}
            or set(draft.translations) != {item["code"] for item in payload["languages"]}
            or any(not tr.title.strip() or not tr.text.strip() for tr in draft.translations.values())
        ):
            raise HTTPException(422, "Bản nháp AI không khớp yêu cầu.")
        try:
            ensure_unique(db, draft.name, draft.source.model_dump())
            error = ""
        except HTTPException as exc:
            error = exc.detail
        if not error:
            result = {"draft": draft.model_dump(), "missing_fields": data.missing_fields,
                      "elapsed_seconds": data.elapsed_seconds, "existing_poi": None}
    # Compare-and-set also protects against a worker finishing while its lease is reclaimed.
    changed = db.execute(update(AiJob).execution_options(synchronize_session=False).where(
        AiJob.id == job.id, AiJob.status == "running", AiJob.lease_hash == digest(data.lease),
        AiJob.lease_until >= now(),
    ).values(status="failed" if error else "completed", result=result, error=error, updated_at=now()))
    db.commit()
    if changed.rowcount != 1:
        raise HTTPException(409, "Lượt xử lý AI đã thay đổi.")
    return {"status": "failed" if error else "completed"}

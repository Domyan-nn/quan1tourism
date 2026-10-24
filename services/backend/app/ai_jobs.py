"""HTTPS pull queue: only the local worker talks to Ollama; no inbound PC port."""

import os
import secrets
from datetime import timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_, select, update, text

from .auth import digest, require
from .content import audit
from .db import get_db
from .duplicates import ensure_unique, find_duplicates
from .languages import languages
from .models import AiJob, AiWorker, Category, now
from .schemas import PoiInput, WikipediaImportInput
from .wikipedia import get_article
from .ai_policy import enforce_translation_policy, job_progress, translation_policy
from .translation_validation import VALIDATOR_VERSION, safe_error, validate_draft_translations

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
        "mode": "worker", "ready": bool(online and worker.ready and worker.protocol >= 3),
        "worker_protocol": worker.protocol if worker else None,
        "model": worker.model if worker else "Ollama",
        "translation_policy": translation_policy(),
        "message": ("Cần cập nhật worker AI protocol 3" if worker.protocol < 3 else
                    "Máy AI sẵn sàng" if worker.ready else "Model trên máy AI chưa sẵn sàng")
        if online else "Máy AI chưa kết nối. Mở Ollama và chạy trình nhận việc trên máy của bạn.",
    }


def prepare_import(db, data):
    available = languages(db, enabled_only=True)
    requested = set(data.language_codes) or {"vi"}
    requested.add("vi")  # Always prepare the Vietnamese draft for administrator review.
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
    from .translation_validation import article_locale
    article["source_locale"] = article_locale(article)
    enforce_translation_policy(sorted(code for code in requested if code != article["source_locale"]) or [article["source_locale"]])
    matches = find_duplicates(db, article["title"], {
        "url": article["url"], "wikidata_id": article["page"].get("pageprops", {}).get("wikibase_item"),
    })
    if matches:
        return None, matches[0]
    categories = [{"id": item.id, "name": item.name} for item in db.scalars(select(Category))]
    if not categories:
        raise HTTPException(409, "Hãy tạo ít nhất một danh mục trước khi nhập địa điểm.")
    return {
        "article": article, "categories": categories, "validation_contract": VALIDATOR_VERSION,
        "languages": [{"code": item.code, "name": item.native_name}
                      for item in available if item.code in requested],
    }, None


def job_data(job):
    execution = job.payload.get("execution", {})
    validation = execution.get("validation")
    if job.status == "completed" and job.result and job.result.get("draft"):
        reports = validate_draft_translations(job.payload["article"], job.result["draft"]["translations"])
        validation = {code: report.to_dict() for code, report in reports.items()}
    reviewable = bool(job.status == "completed" and validation and
                      all(r.get("status") == "passed" for r in validation.values()))
    codes = list(dict.fromkeys(safe_error(code) for code in (
        execution.get("issue_codes", []) + [c for r in (validation or {}).values() for c in r.get("issues", [])]
        + ([job.error] if job.error else []))))
    return {"id": job.id, "status": job.status, "result": job.result,
            "error": safe_error(job.error) if job.error else "", "issue_codes": codes,
            "validation": validation, "reviewable": reviewable, "timings": job_progress(job)}


@router.post("/admin/ai/jobs", status_code=202)
def enqueue(data: WikipediaImportInput, db=Depends(get_db), user=Depends(staff)):
    if not worker_mode():
        raise HTTPException(409, "Máy chủ đang dùng Ollama trực tiếp.")
    active = db.scalar(select(func.count()).select_from(AiJob).where(
        AiJob.requested_by == user.id, AiJob.status.in_(("queued", "running")),
        AiJob.created_at > now() - timedelta(hours=24),
    ))
    if active >= translation_policy()["pending_limit"]:
        raise HTTPException(429, "batch_limited")
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
    protocol: int = Field(default=1, ge=1, le=3)
    job_id: str | None = Field(default=None, max_length=32)
    lease: str | None = Field(default=None, max_length=100)


@router.post("/worker/heartbeat", dependencies=[Depends(worker_auth)])
def heartbeat(data: Heartbeat, db=Depends(get_db)):
    # One configured PC, shared across server instances/restarts.
    worker = db.get(AiWorker, "local")
    if not worker:
        worker = AiWorker(id="local", model=data.model, ready=data.ready)
        db.add(worker)
    worker.model, worker.ready, worker.seen_at = data.model, data.ready, now()
    worker.protocol = data.protocol
    if data.job_id and data.lease:
        job = db.scalar(select(AiJob).where(AiJob.id == data.job_id).with_for_update())
        if (job and job.status == "running" and job.lease_until and aware(job.lease_until) >= now()
                and secrets.compare_digest(job.lease_hash or "", digest(data.lease))):
            job.payload = {**job.payload, "execution": {**job.payload.get("execution", {}),
                           "last_heartbeat_at": now().isoformat()}}
    db.commit()
    return {"status": "ok"}


def expire_jobs(db):
    db.execute(update(AiJob).execution_options(synchronize_session=False).where(
        AiJob.status.in_(("queued", "running")),
        or_(AiJob.created_at < now() - timedelta(hours=24),
            and_(AiJob.status == "running", AiJob.lease_until < now(), AiJob.attempts >= 3)),
    ).values(status="failed", error="worker_unavailable", updated_at=now()))
    db.commit()


class ClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol: int = Field(default=1, ge=1, le=3)


@router.post("/worker/claim", dependencies=[Depends(worker_auth)])
def claim(data: ClaimInput, db=Depends(get_db)):
    expire_jobs(db)
    # A single live claim globally, including multiple accidentally started PCs.
    if db.bind.dialect.name == "postgresql" and not db.scalar(text("SELECT pg_try_advisory_xact_lock(716103046)")):
        return {"job": None}
    if db.scalar(select(AiJob.id).where(AiJob.status == "running", AiJob.lease_until >= now()).limit(1)):
        return {"job": None}
    eligible = or_(AiJob.status == "queued", and_(AiJob.status == "running", AiJob.lease_until < now()))
    if data.protocol < 2:
        kind = AiJob.payload["kind"].as_string()
        eligible = and_(eligible, or_(kind.is_(None), kind != "supplement"))
    if data.protocol < 3:
        eligible = and_(eligible, AiJob.payload["validation_contract"].as_string().is_(None))
    job_id = db.scalar(select(AiJob.id).where(eligible).order_by(AiJob.created_at).limit(1))
    if not job_id:
        return {"job": None}
    candidate = db.get(AiJob, job_id)
    started = now()
    execution = {**candidate.payload.get("execution", {}), "started_at": started.isoformat(),
                 "queue_wait_seconds": round(max(0, (started - aware(candidate.created_at)).total_seconds()), 3)}
    lease = secrets.token_urlsafe(32)
    changed = db.execute(update(AiJob).execution_options(synchronize_session=False).where(AiJob.id == job_id, eligible).values(
        status="running", lease_hash=digest(lease), lease_until=now() + timedelta(seconds=LEASE_SECONDS),
        attempts=AiJob.attempts + 1, updated_at=now(), payload={**candidate.payload, "execution": execution},
    ))
    db.commit()
    if changed.rowcount != 1:
        return {"job": None}
    job = db.get(AiJob, job_id)
    return {"job": {"id": job.id, "lease": lease, "payload": job.payload}}


class Timings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generation_seconds: float | None = Field(default=None, ge=0, le=900)
    validation_seconds: float | None = Field(default=None, ge=0, le=120)


class Completion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease: str = Field(min_length=32, max_length=100)
    draft: PoiInput | None = None
    missing_fields: list[str] = Field(default_factory=list, max_length=10)
    elapsed_seconds: float = Field(default=0, ge=0, le=900)
    error: str = Field(default="", max_length=1000)
    translation: dict | None = None
    model: str = Field(default="", max_length=100)
    issue_codes: list[str] = Field(default_factory=list, max_length=15)
    validation: dict | None = None  # Diagnostic only; NEVER trusted for acceptance.
    timings: Timings = Field(default_factory=Timings)
    prompt_version: str = Field(default="", max_length=80)
    output_mode: Literal["schema", "json", "unconstrained"] = "schema"
    done_reason: Literal["stop", "length", "unknown"] = "unknown"
    locale: str | None = Field(default=None, max_length=35)
    source_revision: int | None = None
    source_hash: str | None = Field(default=None, max_length=64)


@router.post("/worker/jobs/{job_id}/complete", dependencies=[Depends(worker_auth)])
def complete(job_id: str, data: Completion, db=Depends(get_db)):
    job = db.get(AiJob, job_id)
    if not job or not secrets.compare_digest(job.lease_hash or "", digest(data.lease)):
        raise HTTPException(409, "Lượt xử lý AI không còn hợp lệ.")
    if job.status in ("completed", "failed"):
        return {"status": job.status, "issue_codes": job.payload.get("execution", {}).get("issue_codes", [])}
    if not job.lease_until or aware(job.lease_until) < now():
        raise HTTPException(409, "Lượt xử lý AI đã hết hạn.")
    payload = job.payload
    for key in ("locale", "source_revision", "source_hash"):
        received = getattr(data, key)
        if (received is not None and received != payload.get(key)) or (
            payload.get("kind") == "supplement" and payload.get("validation_contract") and received is None
        ):
            raise HTTPException(409, "Result identity differs from the claimed translation job")
    result, reports, issues = None, {}, []
    if data.error:
        issues = list(dict.fromkeys([safe_error(data.error)] + [safe_error(c) for c in data.issue_codes]))
    elif job.payload.get("kind") == "supplement":
        from .narration_jobs import validate_job_translation, source_hash, translation_hash
        from .models import Poi

        validation = validate_job_translation(payload, data.translation)
        reports = validation.to_dict()
        issues = validation.issues
        poi = db.get(Poi, payload["poi_id"])
        if not poi or source_hash(poi) != payload["source_hash"]:
            issues = ["source_changed"]
        elif translation_hash(poi.translations.get(payload["locale"], {})) != payload["target_hash"]:
            issues = ["target_changed"]
        if not issues:
            result = {"translation": data.translation, "locale": payload["locale"],
                      "model": data.model, "generated_at": now().isoformat(), "review_required": True,
                      "validation": reports,
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
        validations = validate_draft_translations(payload["article"], draft.translations)
        reports = {code: report.to_dict() for code, report in validations.items()}
        issues = list(dict.fromkeys(c for report in validations.values() for c in report.issues))
        try:
            ensure_unique(db, draft.name, draft.source.model_dump())
        except HTTPException as exc:
            raise HTTPException(exc.status_code, "Content conflicts with an existing place") from None
        if not issues:
            result = {"draft": draft.model_dump(), "missing_fields": data.missing_fields,
                      "elapsed_seconds": data.elapsed_seconds, "existing_poi": None,
                      "validation": reports, "review_required": True}
    if not data.error and payload.get("validation_contract") and data.done_reason != "stop":
        issues = list(dict.fromkeys(["incomplete_generation"] + issues))
    if issues:
        result = None
    error = issues[0] if issues else ""
    execution = {**payload.get("execution", {}), **data.timings.model_dump(exclude_none=True),
                 "issue_codes": issues, "validation": reports or None,
                 "prompt_version": data.prompt_version, "output_mode": data.output_mode}
    # Compare-and-set also protects against a worker finishing while its lease is reclaimed.
    changed = db.execute(update(AiJob).execution_options(synchronize_session=False).where(
        AiJob.id == job.id, AiJob.status == "running", AiJob.lease_hash == digest(data.lease),
        AiJob.lease_until >= now(),
    ).values(status="failed" if error else "completed", result=result, error=error, updated_at=now(),
             payload={**payload, "execution": execution}))
    db.commit()
    if changed.rowcount != 1:
        raise HTTPException(409, "Lượt xử lý AI đã thay đổi.")
    return {"status": "failed" if error else "completed", "issue_codes": issues}

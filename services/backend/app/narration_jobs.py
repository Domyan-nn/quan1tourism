"""One durable queue item per locale. Results stay private until explicit review and save."""

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func

from .auth import require
from .content import audit, check_revision, get_poi, serialize, touch
from .db import get_db
from .languages import languages
from .models import AiJob, Poi, now
from .schemas import TranslationInput
from .ai_policy import enforce_translation_policy, job_progress, translation_policy
from .translation_validation import validate_translation, VALIDATOR_VERSION, safe_error

router = APIRouter(prefix="/api/v1/admin/pois")
administrator = require("admin")


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def translation_hash(value):
    return fingerprint({"title": value.get("title", ""), "text": value.get("text", "")})


def source_data(poi):
    return {"name": poi.name or "", "address": poi.address or "",
            "short_description": poi.short_description or "", "source": poi.source,
            "source_locale": "vi", "source_title": (poi.translations or {}).get("vi", {}).get("title", ""),
            "source_text": (poi.translations or {}).get("vi", {}).get("text", "")}


def source_hash(poi):
    return fingerprint(source_data(poi))


def validate_job_translation(payload, translation):
    source = payload.get("source", {})
    return validate_translation(source.get("source_text", ""), source.get("source_locale", "vi"),
        translation, payload["locale"], protected_terms=(source.get("name", ""), source.get("address", "")))


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    language_codes: list[str] = Field(default_factory=list, max_length=100)
    replace_existing: bool = False
    confirmed_source: bool = False


def jobs_for(db, poi_id):
    return list(db.scalars(select(AiJob).where(AiJob.payload["kind"].as_string() == "supplement",
        AiJob.payload["poi_id"].as_string() == poi_id).order_by(AiJob.created_at.desc()).limit(500)))


def summary(job):
    execution = job.payload.get("execution", {})
    validation = execution.get("validation")
    if job.status == "completed" and job.result:
        # Recheck legacy "completed" results too, without modifying history.
        validation = validate_job_translation(job.payload, job.result.get("translation")).to_dict()
    codes = list(dict.fromkeys(safe_error(code) for code in (
        execution.get("issue_codes", []) + (validation["issues"] if validation else [])
        + ([job.error] if job.error else []))))
    return {"id": job.id, "locale": job.payload["locale"], "status": job.status,
            "error": safe_error(job.error) if job.error else "", "result": job.result,
            "source_revision": job.payload["source_revision"], "validation": validation,
            "issue_codes": codes,
            "reviewable": bool(job.status == "completed" and validation and validation["status"] == "passed"),
            "timings": job_progress(job)}


@router.get("/{poi_id}/narration-jobs")
def list_jobs(poi_id: str, db=Depends(get_db), user=Depends(administrator)):
    poi = get_poi(db, poi_id)
    from .ai_jobs import expire_jobs, queue_status

    expire_jobs(db)
    return {"items": [{**summary(job), "source_changed": job.payload["source_hash"] != source_hash(poi)}
                      for job in jobs_for(db, poi_id)], "policy": translation_policy(),
            "worker_ready": queue_status(db)["ready"]}


@router.post("/{poi_id}/narration-jobs", status_code=202)
def enqueue(poi_id: str, data: GenerateInput, db=Depends(get_db), user=Depends(administrator)):
    from .ai_jobs import expire_jobs

    expire_jobs(db)
    poi = db.scalar(select(Poi).where(Poi.id == poi_id).with_for_update())
    if not poi:
        raise HTTPException(404, "Place not found")
    check_revision(poi, data.revision)
    if not data.confirmed_source or not source_data(poi)["source_text"].strip():
        raise HTTPException(422, "Verify and save the Vietnamese source narration before generating translations")
    available = {item.code: item for item in languages(db, enabled_only=True)}
    requested = list(dict.fromkeys(data.language_codes))
    if not requested or any(code not in available or code == "vi" for code in requested):
        raise HTTPException(422, "Select enabled target languages other than the source language")
    enforce_translation_policy(requested)
    active = {(job.payload["locale"], job.payload["source_revision"], job.payload["source_hash"]): job
              for job in jobs_for(db, poi_id) if job.status in {"queued", "running"}}
    new_codes = [code for code in requested if (code, poi.revision, source_hash(poi)) not in active]
    pending = db.scalar(select(func.count()).select_from(AiJob).where(AiJob.requested_by == user.id,
                        AiJob.status.in_(("queued", "running"))))
    if pending + len(new_codes) > translation_policy()["pending_limit"]:
        raise HTTPException(429, "batch_limited")
    created = []
    for code in requested:
        target = poi.translations.get(code, {})
        if (target.get("text", "").strip() or target.get("title", "").strip()) and not data.replace_existing:
            raise HTTPException(409, "Existing narration requires explicit replacement confirmation")
        key = (code, poi.revision, source_hash(poi))
        if key in active:
            created.append(active[key])
            continue
        language = available[code]
        job = AiJob(requested_by=user.id, payload={
            "kind": "supplement", "protocol": 3, "poi_id": poi.id, "locale": code,
            "language_name": language.native_name, "source_revision": poi.revision,
            "source_locale": "vi", "validation_contract": VALIDATOR_VERSION,
            "source_hash": source_hash(poi), "target_hash": translation_hash(target),
            "source": source_data(poi),
        })
        db.add(job)
        created.append(job)
    audit(db, user, poi, "ai_supplement", ",".join(requested))
    db.commit()
    return {"items": [summary(job) for job in created], "policy": translation_policy()}


class ApplyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    confirmed_review: bool
    translation: TranslationInput


@router.post("/{poi_id}/narration-jobs/{job_id}/apply")
def apply(poi_id: str, job_id: str, data: ApplyInput, db=Depends(get_db), user=Depends(administrator)):
    poi = db.scalar(select(Poi).where(Poi.id == poi_id).with_for_update())
    if not poi:
        raise HTTPException(404, "Place not found")
    check_revision(poi, data.revision)
    job = db.get(AiJob, job_id)
    if not job or job.payload.get("poi_id") != poi.id or job.status != "completed" or not job.result:
        raise HTTPException(409, "No completed translation to review")
    payload = job.payload
    code = payload["locale"]
    if not any(item.code == code for item in languages(db, enabled_only=True)):
        raise HTTPException(409, "Target language has been disabled")
    if payload["source_hash"] != source_hash(poi) or payload["target_hash"] != translation_hash(poi.translations.get(code, {})):
        raise HTTPException(409, "Source or target was edited after this request. Generate again; no content was overwritten")
    validation = validate_job_translation(payload, data.translation)
    if not data.confirmed_review:
        raise HTTPException(422, "Review language, facts and complete narration before saving the draft")
    if not validation.passed:
        raise HTTPException(422, validation.issues[0])
    values = dict(poi.translations)
    values[code] = data.translation.model_dump()
    poi.translations = values
    poi.narration_meta = {**(poi.narration_meta or {}), code: {
        "origin": "ai_reviewed", "source_locale": "vi", "source_revision": payload["source_revision"],
        "source_hash": payload["source_hash"], "model": job.result["model"],
        "generated_at": job.result["generated_at"], "reviewed_at": now().isoformat(), "stale": False,
    }}
    poi.status = "draft"
    job.result = {**job.result, "applied_at": now().isoformat(), "validation": validation.to_dict()}
    touch(poi)
    audit(db, user, poi, "ai_translation_save", code)
    db.commit()
    return serialize(poi, db, statistics=True)

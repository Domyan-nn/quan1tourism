"""Environment-owned pilot limits. No language is implicitly benchmark-approved."""
import os

from fastapi import HTTPException

from .translation_validation import LANGUAGES, language_code


def bounded_setting(name, default, low, high):
    try:
        return max(low, min(high, int(os.getenv(name, default))))
    except (TypeError, ValueError):
        return default


def translation_policy():
    verified = [c.strip() for c in os.getenv("AI_TRANSLATION_VERIFIED_LOCALES", "").split(",") if c.strip()]
    return {"batch_limit": bounded_setting("AI_TRANSLATION_BATCH_LIMIT", 1, 1, 10),
            "enabled": os.getenv("AI_TRANSLATION_ENABLED", "true").lower() == "true",
            "pending_limit": bounded_setting("AI_TRANSLATION_PENDING_LIMIT", 3, 1, 10),
            "verified_locales": verified, "experimental": not verified,
            "generation_timeout_seconds": bounded_setting("AI_GENERATION_TIMEOUT_SECONDS", 120, 30, 300),
            "model_verified": bool(verified), "supported_locales": list(LANGUAGES)}


def enforce_translation_policy(codes):
    policy = translation_policy()
    if not policy["enabled"]:
        raise HTTPException(422, "language_not_verified")
    if not codes or len(codes) > policy["batch_limit"]:
        raise HTTPException(422, "batch_limited")
    if any(language_code(c) is None for c in codes):
        raise HTTPException(422, "language_uncertain")
    if len(codes) > 1 and any(c not in policy["verified_locales"] for c in codes):
        raise HTTPException(422, "language_not_verified")


def job_progress(job):
    from datetime import datetime
    from .models import now
    from .ai_jobs import aware

    execution = job.payload.get("execution", {})
    elapsed = max(0, (now() - aware(job.created_at)).total_seconds())
    generation = execution.get("generation_seconds")
    if job.status == "running" and execution.get("started_at"):
        generation = round(max(0, (now() - aware(datetime.fromisoformat(execution["started_at"]))).total_seconds()), 1)
    return {"queue_wait_seconds": execution.get("queue_wait_seconds", round(elapsed, 1) if job.status == "queued" else None),
            "generation_seconds": generation,
            "validation_seconds": execution.get("validation_seconds"),
            "total_seconds": round((aware(job.updated_at) - aware(job.created_at)).total_seconds(), 1)
            if job.status in {"completed", "failed"} else round(elapsed, 1),
            "started_at": execution.get("started_at"), "last_heartbeat_at": execution.get("last_heartbeat_at")}

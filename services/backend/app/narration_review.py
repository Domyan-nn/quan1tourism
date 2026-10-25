"""Content-bound human approval, separate from AI validation and publication.

Approval evidence lives in the existing durable narration_meta JSON. Legacy
text without this evidence remains pending; public Release snapshots are untouched.
"""

import hashlib
import json

from sqlalchemy import select

from .languages import languages
from .models import AiJob, now
from .translation_validation import validate_draft_translations, validate_translation


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


def jobs_for(db, poi_id):
    return list(db.scalars(select(AiJob).where(AiJob.payload["kind"].as_string() == "supplement",
        AiJob.payload["poi_id"].as_string() == poi_id).order_by(AiJob.created_at.desc())))


def import_origins(poi, db, codes):
    """Recognize unchanged initial imports from a server-verified completed job.

    Source.model supplied by a client is never enough to establish AI origin.
    """
    if not poi.source or not codes:
        return {}
    matches = {}
    candidates = db.scalars(select(AiJob).where(AiJob.status == "completed",
        AiJob.result["draft"]["source"]["url"].as_string() == poi.source.get("url"))
        .order_by(AiJob.created_at.desc()))
    for job in candidates:
        draft = (job.result or {}).get("draft", {})
        source = draft.get("source", {})
        if source.get("revision_id") != poi.source.get("revision_id") or not job.payload.get("article"):
            continue
        reports = validate_draft_translations(job.payload["article"], draft.get("translations", {}))
        for code in codes - matches.keys():
            generated = draft.get("translations", {}).get(code, {})
            normalized = {key: generated.get(key, "").strip() for key in ("title", "text")}
            if (code in reports and reports[code].passed
                    and translation_hash(normalized) == translation_hash(poi.translations.get(code, {}))):
                matches[code] = {"origin": "ai_import", "model": source.get("model", ""), "import_job_id": job.id}
        if codes <= matches.keys():
            break
    return matches


def job_matches(job, poi):
    payload = job.payload
    return (payload.get("poi_id") == poi.id
            and 0 < payload.get("source_revision", 0) <= poi.revision
            and payload.get("source_hash") == source_hash(poi)
            and payload.get("target_hash") == translation_hash(poi.translations.get(payload.get("locale"), {})))


def pending_result(job, poi):
    return bool(job.status == "completed" and job.result
                and not job.result.get("applied_at") and not job.result.get("discarded_at")
                and job_matches(job, poi)
                and validate_job_translation(job.payload, job.result.get("translation")).passed)


def mark_reviewed(poi, user, db):
    """Called only by the existing admin approval / publication workflows."""
    meta = dict(poi.narration_meta or {})
    enabled = {language.code for language in languages(db, enabled_only=True)}
    for code, tr in poi.translations.items():
        if code in enabled and tr.get("title", "").strip() and tr.get("text", "").strip():
            meta[code] = {**meta.get(code, {}), "stale": False, "approval": {
                "content_hash": translation_hash(tr), "revision": poi.revision,
                "reviewed_by": user.id, "reviewed_at": now().isoformat(),
            }}
    poi.narration_meta = meta


def review_states(poi, db, jobs=None):
    pending = {}
    for job in jobs if jobs is not None else jobs_for(db, poi.id):
        code = job.payload.get("locale")
        if code not in pending and pending_result(job, poi):
            pending[code] = job.id
    states = {}
    for language in languages(db):
        code = language.code
        tr = poi.translations.get(code, {})
        meta = (poi.narration_meta or {}).get(code, {})
        approval = meta.get("approval", {})
        has_content = bool(tr.get("title", "").strip() or tr.get("text", "").strip())
        approved = bool(has_content and not meta.get("stale")
                        and approval.get("content_hash") == translation_hash(tr)
                        and approval.get("reviewed_by") and approval.get("reviewed_at")
                        and 0 < approval.get("revision", 0) <= poi.revision)
        job_id = pending.get(code) if language.enabled else None
        states[code] = {
            "state": "pending" if job_id else "approved" if approved else "pending" if has_content else "empty",
            "source": "ai" if job_id or meta.get("origin", "").startswith("ai") else "manual" if has_content else None,
            "approved_current": approved, "pending_job_id": job_id,
            "preserves_approved": bool(approved and job_id),
        }
    return states

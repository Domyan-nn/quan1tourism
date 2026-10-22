import copy

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import digest
from .models import Audit, Media, Poi, Release, User, now

LOCALES = ("vi", "en")


def iso(value):
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


def serialize(poi: Poi, db: Session):
    translations = {}
    for locale in LOCALES:
        tr = poi.translations.get(locale, {})
        audio = db.get(Media, tr.get("audio_id")) if tr.get("audio_id") else None
        translations[locale] = {
            "title": tr.get("title", ""),
            "text": tr.get("text", ""),
            "audio_id": audio.id if audio else None,
            "audio_duration": audio.duration if audio else None,
            "audio_valid": bool(audio and audio.text_hash == digest(tr.get("text", ""))),
        }
    return {
        "id": poi.id,
        "name": poi.name,
        "address": poi.address,
        "category_id": poi.category_id,
        "latitude": poi.latitude,
        "longitude": poi.longitude,
        "status": poi.status,
        "revision": poi.revision,
        "updated_at": iso(poi.updated_at),
        "image_id": poi.image_id,
        "cover": poi.cover,
        "translations": translations,
        "note": poi.note,
        "is_demo": poi.is_demo,
        "has_published": db.scalar(
            select(Release.id).where(Release.poi_id == poi.id, Release.is_current.is_(True))
        )
        is not None,
    }


def get_poi(db: Session, poi_id: str):
    poi = db.get(Poi, poi_id)
    if not poi:
        raise HTTPException(404, "Không tìm thấy địa điểm.")
    return poi


def check_revision(poi: Poi, revision: int):
    if poi.revision != revision:
        raise HTTPException(409, "Nội dung vừa được người khác cập nhật. Hãy mở lại địa điểm trước khi lưu.")


def audit(db: Session, user: User, poi: Poi | None, action: str, detail: str = ""):
    db.add(Audit(poi_id=poi.id if poi else None, actor=user.name, action=action, detail=detail))


def touch(poi: Poi):
    poi.updated_at = now()
    poi.revision += 1


def ready(poi: Poi, db: Session):
    for locale, name in (("vi", "Tiếng Việt"), ("en", "Tiếng Anh")):
        tr = serialize(poi, db)["translations"][locale]
        if not tr["title"].strip() or not tr["text"].strip():
            raise HTTPException(422, f"{name}: cần có tiêu đề và bài thuyết minh trước khi gửi duyệt.")
        if not tr["audio_valid"]:
            raise HTTPException(422, f"{name}: hãy tải audio phù hợp với bài thuyết minh hiện tại.")


def transition(db: Session, poi: Poi, user: User, data):
    check_revision(poi, data.revision)
    action = data.action
    if action in ("approve", "reject", "publish", "archive") and user.role not in ("reviewer", "admin"):
        raise HTTPException(403, "Chỉ người duyệt và quản trị viên được thực hiện thao tác này.")
    allowed = {
        "submit": ("draft",),
        "approve": ("in_review",),
        "reject": ("in_review", "approved"),
        "publish": ("approved",),
        "archive": ("published", "draft", "approved", "in_review"),
        "restore": ("draft", "published", "archived"),
    }
    if poi.status not in allowed[action]:
        raise HTTPException(409, "Trạng thái nội dung đã thay đổi. Hãy mở lại địa điểm để tiếp tục.")
    if action in ("submit", "approve", "publish"):
        ready(poi, db)
    if action == "reject" and not data.note.strip():
        raise HTTPException(422, "Vui lòng ghi lý do để người biên tập biết cần chỉnh sửa gì.")
    if action == "restore":
        release = db.get(Release, data.release_id) if data.release_id else None
        if (data.release_id and (not release or release.poi_id != poi.id)) or (
            not release and poi.status != "archived"
        ):
            raise HTTPException(404, "Không tìm thấy phiên bản của địa điểm này.")
        if release:
            snapshot = release.snapshot
            for field in (
                "name",
                "address",
                "category_id",
                "latitude",
                "longitude",
                "image_id",
                "translations",
            ):
                setattr(poi, field, copy.deepcopy(snapshot[field]))
        poi.status = "draft"
    else:
        poi.status = {
            "submit": "in_review",
            "approve": "approved",
            "reject": "draft",
            "publish": "published",
            "archive": "archived",
        }[action]
    poi.note = data.note
    touch(poi)
    if action == "publish":
        for release in db.scalars(
            select(Release).where(Release.poi_id == poi.id, Release.is_current.is_(True))
        ):
            release.is_current = False
        snapshot = serialize(poi, db)
        snapshot["has_published"] = True
        db.add(Release(poi_id=poi.id, revision=poi.revision, snapshot=snapshot))
        ids = [tr.get("audio_id") for tr in poi.translations.values()] + [poi.image_id]
        for media_id in filter(None, ids):
            media = db.get(Media, media_id)
            if media:
                media.is_public = True
    if action == "archive":
        for release in db.scalars(
            select(Release).where(Release.poi_id == poi.id, Release.is_current.is_(True))
        ):
            release.is_current = False
    audit(db, user, poi, action, data.note)

import copy

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .languages import languages
from .models import Audit, Media, Poi, Release, User, now


def iso(value):
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


def serialize(poi: Poi, db: Session, *, statistics=False):
    translations = {}
    values = poi.translations
    for language in languages(db):
        locale = language.code
        tr = values.get(locale, {})
        translations[locale] = {
            "title": tr.get("title", ""),
            "text": tr.get("text", ""),
            "tts_ready": bool(tr.get("title", "").strip() and tr.get("text", "").strip()),
        }
    return {
        "id": poi.id,
        "name": poi.name,
        "address": poi.address,
        "short_description": poi.short_description,
        **({"view_count": poi.view_count, "listen_count": poi.listen_count} if statistics else {}),
        "category_id": poi.category_id,
        "latitude": poi.latitude,
        "longitude": poi.longitude,
        "source": poi.source,
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
    values = poi.translations
    for language in languages(db, enabled_only=True):
        tr = values.get(language.code, {})
        title, text = tr.get("title", "").strip(), tr.get("text", "").strip()
        if (language.required or title or text) and not (title and text):
            raise HTTPException(
                422, f"{language.native_name}: cần có tiêu đề và bài thuyết minh trước khi gửi duyệt."
            )


def text_snapshot(snapshot):
    """Expose narration text for both new and historical releases, never legacy audio links."""
    result = copy.deepcopy(snapshot)
    result.pop("view_count", None)
    result.pop("listen_count", None)
    result["translations"] = {
        code: {
            "title": tr.get("title", ""),
            "text": tr.get("text", ""),
            "tts_ready": bool(tr.get("title", "").strip() and tr.get("text", "").strip()),
        }
        for code, tr in snapshot.get("translations", {}).items()
    }
    return result


def transition(db: Session, poi: Poi, user: User, data):
    check_revision(poi, data.revision)
    action = data.action
    if action in ("approve", "publish") and user.role != "admin":
        raise HTTPException(403, "Quản trị viên phải kiểm tra và duyệt địa điểm trước khi xuất bản.")
    if action == "approve" and not data.confirmed_review:
        raise HTTPException(422, "Xác nhận đã kiểm tra địa điểm, nguồn, vị trí và nội dung trước khi duyệt.")
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
            from .duplicates import ensure_unique, reserve_identities

            ensure_unique(db, snapshot["name"], snapshot.get("source"), poi.id)
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
            poi.source = copy.deepcopy(snapshot.get("source"))
            poi.short_description = snapshot.get("short_description", "")
            reserve_identities(db, poi)
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
        for media_id in filter(None, [poi.image_id]):
            media = db.get(Media, media_id)
            if media:
                media.is_public = True
    if action == "archive":
        for release in db.scalars(
            select(Release).where(Release.poi_id == poi.id, Release.is_current.is_(True))
        ):
            release.is_current = False
    audit(db, user, poi, action, ("Đã kiểm tra tên, địa chỉ, tọa độ, nguồn và thuyết minh. "
                               if action == "approve" else "") + data.note)

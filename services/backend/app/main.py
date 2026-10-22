import io
import secrets
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from mutagen import File as AudioFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm.exc import StaleDataError

from .auth import COOKIE, COOKIE_SECURE, current_user, digest, optional_user, passwords, require
from .content import audit, check_revision, get_poi, iso, serialize, touch, transition
from .db import MEDIA_ROOT, get_db
from .models import Audit, Category, Media, Poi, Release, Session, User, now, uid
from .schemas import ActionInput, CategoryInput, Login, PoiInput

app = FastAPI(title="Saigon Stories API", version="0.1.0")
editors = require("editor", "reviewer", "admin")
login_attempts: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = uuid.uuid4().hex
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.headers.get("X-Requested-With") != "Quan1Admin"
    ):
        return JSONResponse({"detail": "Yêu cầu không hợp lệ.", "request_id": request_id}, status_code=403)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/v1/admin") or request.url.path.startswith("/api/v1/auth"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Never echo login input or uploaded content back into errors/logs.
    return JSONResponse(
        {"detail": "Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc, độ dài và tọa độ."}, status_code=422
    )


@app.exception_handler(StaleDataError)
async def stale_error(request, exc):
    return JSONResponse(
        {"detail": "Nội dung vừa được cập nhật ở phiên khác. Vui lòng mở lại."}, status_code=409
    )


@app.get("/api/v1/health/live")
def live():
    return {"status": "ok"}


@app.get("/api/v1/health/ready")
def readiness(db: DbSession = Depends(get_db)):
    db.execute(text("SELECT 1 FROM users LIMIT 1"))
    return {"status": "ok"}


def user_data(user):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@app.post("/api/v1/auth/login")
def login(data: Login, request: Request, response: Response, db: DbSession = Depends(get_db)):
    key = request.client.host if request.client else "local"
    attempts = login_attempts[key]
    cutoff = time.monotonic() - 300
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(429, "Bạn đã thử đăng nhập nhiều lần. Vui lòng thử lại sau 5 phút.")
    attempts.append(time.monotonic())
    user = db.scalar(select(User).where(User.email == data.email.strip().lower()))
    if not user or not passwords.verify(data.password, user.password_hash):
        raise HTTPException(401, "Email hoặc mật khẩu chưa đúng.")
    attempts.clear()
    old = request.cookies.get(COOKIE)
    if old and (session := db.get(Session, digest(old))):
        db.delete(session)
    token = secrets.token_urlsafe(48)
    db.add(Session(token_hash=digest(token), user_id=user.id, expires_at=now() + timedelta(hours=8)))
    db.commit()
    response.set_cookie(
        COOKIE, token, httponly=True, secure=COOKIE_SECURE, samesite="strict", max_age=28800, path="/"
    )
    return user_data(user)


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return user_data(user)


@app.post("/api/v1/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token and (session := db.get(Session, digest(token))):
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE, path="/")


@app.get("/api/v1/admin/categories")
def categories(db: DbSession = Depends(get_db), user: User = Depends(current_user)):
    return [
        {
            "id": c.id,
            "name": c.name,
            "color": c.color,
            "count": db.scalar(select(func.count()).select_from(Poi).where(Poi.category_id == c.id)),
        }
        for c in db.scalars(select(Category).order_by(Category.name))
    ]


@app.post("/api/v1/admin/categories", status_code=201)
def create_category(data: CategoryInput, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    name = data.name.strip()
    if not name:
        raise HTTPException(422, "Vui lòng nhập tên danh mục.")
    category = Category(name=name, color=data.color)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Tên danh mục đã tồn tại.")
    return {"id": category.id, "name": category.name, "color": category.color, "count": 0}


@app.delete("/api/v1/admin/categories/{category_id}", status_code=204)
def delete_category(
    category_id: str, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))
):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Không tìm thấy danh mục.")
    if db.scalar(select(Poi.id).where(Poi.category_id == category_id).limit(1)):
        raise HTTPException(
            409, "Danh mục đang có địa điểm. Hãy chuyển các địa điểm sang danh mục khác trước."
        )
    db.delete(category)
    db.commit()


def normalized(value: str):
    return "".join(
        c
        for c in unicodedata.normalize("NFD", value.lower().replace("đ", "d"))
        if not unicodedata.combining(c)
    )


@app.get("/api/v1/admin/pois")
def list_pois(
    q: str = "",
    status: str = "",
    category: str = "",
    sort: str = "updated",
    page: int = Query(1, ge=1),
    page_size: int = Query(8, ge=1, le=100),
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
):
    query = select(Poi)
    if status:
        query = query.where(Poi.status == status)
    if category:
        query = query.where(Poi.category_id == category)
    query = query.order_by(Poi.name if sort == "name" else Poi.updated_at.desc(), Poi.id)
    pois = list(db.scalars(query))
    if q:
        pois = [p for p in pois if normalized(q.strip()) in normalized(p.name + " " + p.address)]
    return {
        "items": [serialize(p, db) for p in pois[(page - 1) * page_size : page * page_size]],
        "total": len(pois),
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/v1/admin/summary")
def summary(db: DbSession = Depends(get_db), user: User = Depends(current_user)):
    pois = list(db.scalars(select(Poi)))
    data = [serialize(p, db) for p in pois]
    return {
        "total": len(data),
        "published": sum(p["has_published"] for p in data),
        "in_review": sum(p["status"] == "in_review" for p in data),
        "draft": sum(p["status"] == "draft" for p in data),
        "audio_ready": sum(all(t["audio_valid"] for t in p["translations"].values()) for p in data),
        "translations_ready": sum(
            all(t["title"].strip() and t["text"].strip() for t in p["translations"].values()) for p in data
        ),
    }


def apply_input(poi: Poi, data: PoiInput, db: DbSession):
    if not data.name.strip() or not db.get(Category, data.category_id):
        raise HTTPException(422, "Vui lòng nhập tên và chọn danh mục hợp lệ.")
    for key in ("name", "address", "category_id", "latitude", "longitude"):
        setattr(poi, key, getattr(data, key).strip() if key in ("name", "address") else getattr(data, key))
    translations = {}
    for locale in ("vi", "en"):
        tr = data.translations.get(locale)
        translations[locale] = {
            "title": tr.title.strip() if tr else "",
            "text": tr.text.strip() if tr else "",
            "audio_id": (poi.translations or {}).get(locale, {}).get("audio_id"),
        }
    poi.translations = translations


@app.post("/api/v1/admin/pois", status_code=201)
def create_poi(data: PoiInput, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    poi = Poi(id=uid(), translations={})
    apply_input(poi, data, db)
    db.add(poi)
    db.flush()
    audit(db, user, poi, "create")
    db.commit()
    return serialize(poi, db)


@app.get("/api/v1/admin/pois/{poi_id}")
def detail(poi_id: str, db: DbSession = Depends(get_db), user: User = Depends(current_user)):
    return serialize(get_poi(db, poi_id), db)


@app.put("/api/v1/admin/pois/{poi_id}")
def update_poi(poi_id: str, data: PoiInput, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    poi = get_poi(db, poi_id)
    check_revision(poi, data.revision)
    if poi.status in ("in_review", "archived"):
        raise HTTPException(409, "Hãy trả nội dung về bản nháp trước khi chỉnh sửa.")
    apply_input(poi, data, db)
    poi.status = "draft"
    touch(poi)
    audit(db, user, poi, "update")
    db.commit()
    return serialize(poi, db)


@app.post("/api/v1/admin/pois/{poi_id}/actions")
def action(poi_id: str, data: ActionInput, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    poi = get_poi(db, poi_id)
    transition(db, poi, user, data)
    db.commit()
    return serialize(poi, db)


@app.get("/api/v1/admin/pois/{poi_id}/history")
def history(poi_id: str, db: DbSession = Depends(get_db), user: User = Depends(current_user)):
    get_poi(db, poi_id)
    return {
        "events": [
            {
                "id": a.id,
                "action": a.action,
                "actor": a.actor,
                "detail": a.detail,
                "created_at": iso(a.created_at),
            }
            for a in db.scalars(select(Audit).where(Audit.poi_id == poi_id).order_by(Audit.id.desc()))
        ],
        "releases": [
            {"id": r.id, "revision": r.revision, "snapshot": r.snapshot, "created_at": iso(r.created_at)}
            for r in db.scalars(
                select(Release).where(Release.poi_id == poi_id).order_by(Release.revision.desc())
            )
        ],
    }


@app.post("/api/v1/admin/pois/{poi_id}/upload")
async def upload(
    poi_id: str,
    file: UploadFile,
    kind: str = Query(pattern="^(audio|image)$"),
    revision: int = Query(ge=1),
    locale: str = Query("vi", pattern="^(vi|en)$"),
    db: DbSession = Depends(get_db),
    user: User = Depends(editors),
):
    poi = get_poi(db, poi_id)
    check_revision(poi, revision)
    if poi.status in ("in_review", "archived"):
        raise HTTPException(409, "Nội dung cần ở trạng thái bản nháp để tải tệp.")
    limit = (50 if kind == "audio" else 10) * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(413, f"Tệp quá lớn. Giới hạn {'50' if kind == 'audio' else '10'} MB.")
    duration = None
    text_hash = None
    raw = bytes(data)
    if kind == "image":
        try:
            with Image.open(io.BytesIO(raw)) as image:
                ext, mime = {
                    "JPEG": ("jpg", "image/jpeg"),
                    "PNG": ("png", "image/png"),
                    "WEBP": ("webp", "image/webp"),
                }[image.format]
                if image.width * image.height > 20_000_000:
                    raise ValueError()
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, KeyError, Image.DecompressionBombError):
            raise HTTPException(422, "Ảnh không hợp lệ. Chọn JPG, PNG hoặc WebP, tối đa 20 triệu điểm ảnh.")
    else:
        narration = poi.translations.get(locale, {}).get("text", "")
        if not narration.strip():
            raise HTTPException(422, "Hãy lưu bài thuyết minh trước khi tải audio.")
        try:
            audio = AudioFile(io.BytesIO(raw))
            if audio is None or not audio.info.length or audio.info.length > 7200:
                raise ValueError()
            duration = round(audio.info.length, 2)
            audio_type = type(audio).__name__
            ext, mime = {
                "WAVE": ("wav", "audio/wav"),
                "MP3": ("mp3", "audio/mpeg"),
                "OggVorbis": ("ogg", "audio/ogg"),
                "OggOpus": ("ogg", "audio/ogg"),
                "MP4": ("m4a", "audio/mp4"),
            }[audio_type]
            text_hash = digest(narration)
        except Exception:
            raise HTTPException(
                422, "Audio không hợp lệ. Chọn MP3, WAV, OGG hoặc M4A có thời lượng dưới 2 giờ."
            )
    if (
        file.content_type != mime
        and not (mime == "audio/wav" and file.content_type in ("audio/x-wav", "audio/wave"))
        and not (mime == "audio/mp4" and file.content_type == "audio/x-m4a")
    ):
        raise HTTPException(422, "Định dạng bên trong tệp không khớp loại tệp đã gửi.")
    media_id = uid()
    filename = f"{media_id}.{ext}"
    path = MEDIA_ROOT / filename
    path.write_bytes(raw)
    media = Media(
        id=media_id,
        poi_id=poi.id,
        kind=kind,
        locale=locale if kind == "audio" else None,
        filename=filename,
        mime=mime,
        size=len(raw),
        checksum=digest_bytes(raw),
        duration=duration,
        text_hash=text_hash,
    )
    db.add(media)
    db.flush()
    if kind == "image":
        poi.image_id = media_id
    else:
        translations = {k: dict(v) for k, v in poi.translations.items()}
        translations[locale]["audio_id"] = media_id
        poi.translations = translations
    poi.status = "draft"
    touch(poi)
    audit(db, user, poi, "upload", f"{kind}:{locale}")
    try:
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return serialize(poi, db)


def digest_bytes(value):
    import hashlib

    return hashlib.sha256(value).hexdigest()


@app.get("/api/v1/media/{media_id}")
def media_file(media_id: str, request: Request, db: DbSession = Depends(get_db)):
    media = db.get(Media, media_id)
    if not media or (not media.is_public and not optional_user(request, db)):
        raise HTTPException(404, "Không tìm thấy tệp.")
    path = MEDIA_ROOT / media.filename
    if not path.is_file():
        raise HTTPException(404, "Tệp hiện không có sẵn.")
    return FileResponse(
        path,
        media_type=media.mime,
        headers={"Cache-Control": "private, no-store" if not media.is_public else "public, max-age=3600"},
    )


@app.get("/api/v1/pois")
def public_pois(locale: str = Query("vi", pattern="^(vi|en)$"), db: DbSession = Depends(get_db)):
    return {
        "items": [
            r.snapshot
            for r in db.scalars(
                select(Release).where(Release.is_current.is_(True)).order_by(Release.created_at.desc())
            )
            if r.snapshot["translations"].get(locale, {}).get("audio_valid")
        ]
    }


@app.get("/api/v1/pois/{poi_id}")
def public_poi(poi_id: str, locale: str = Query("vi", pattern="^(vi|en)$"), db: DbSession = Depends(get_db)):
    release = db.scalar(select(Release).where(Release.poi_id == poi_id, Release.is_current.is_(True)))
    if not release:
        raise HTTPException(404, "Địa điểm này chưa được xuất bản hoặc đã được lưu trữ.")
    if not release.snapshot["translations"].get(locale, {}).get("audio_valid"):
        raise HTTPException(404, "Chưa có thuyết minh cho ngôn ngữ này. Vui lòng chọn ngôn ngữ khác.")
    return release.snapshot

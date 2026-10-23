import io
import os
import secrets
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm.exc import StaleDataError

from .auth import COOKIE, COOKIE_SECURE, current_user, digest, optional_user, passwords, require
from .content import audit, check_revision, get_poi, iso, ready, serialize, text_snapshot, touch, transition
from .engagement import ENGAGEMENT_COOKIE, record
from .geocoding import search_places
from .languages import get_language, language_data, languages
from .db import MEDIA_ROOT, get_db
from .models import Audit, Category, Language, Media, Poi, Release, Session, User, now, uid
from .schemas import ActionInput, CategoryInput, LanguageInput, Login, PoiInput, Register, WikipediaImportInput
from .wikipedia import generate_draft, ollama_status
from .ai_jobs import prepare_import, queue_status, router as ai_router, worker_mode
from .duplicates import ensure_unique, find_duplicates, reserve_identities

app = FastAPI(title="Saigon Stories API", version="0.1.0")
app.include_router(ai_router)
editors = require("editor", "reviewer", "admin")
login_attempts: dict[str, deque] = defaultdict(deque)
registration_attempts: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = uuid.uuid4().hex
    visit_session = request.cookies.get(ENGAGEMENT_COOKIE, "")
    new_visit = len(visit_session) != 64 or any(c not in "0123456789abcdef" for c in visit_session)
    request.state.visit_session = secrets.token_hex(32) if new_visit else visit_session
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.headers.get("X-Requested-With") != "Quan1Admin"
    ):
        return JSONResponse({"detail": "Yêu cầu không hợp lệ.", "request_id": request_id}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/api/v1/pois"):
        response.headers["Cache-Control"] = "no-store"
        if new_visit:
            response.set_cookie(ENGAGEMENT_COOKIE, request.state.visit_session, httponly=True,
                                secure=COOKIE_SECURE, samesite="strict", path="/")
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith(("/api/v1/admin", "/api/v1/auth", "/api/v1/worker")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Never echo login input or uploaded content back into errors/logs.
    if request.url.path == "/api/v1/auth/register":
        return JSONResponse(
            {"detail": "Nhập họ tên, email hợp lệ và mật khẩu từ 8 đến 200 ký tự. Không thêm trường khác."},
            status_code=422,
        )
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


def start_session(user: User, request: Request, response: Response, db: DbSession):
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


@app.post("/api/v1/auth/register", status_code=201)
def register(data: Register, request: Request, response: Response, db: DbSession = Depends(get_db)):
    key = request.client.host if request.client else "local"
    attempts = registration_attempts[key]
    cutoff = time.monotonic() - 300
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(429, "Bạn đã thử đăng ký nhiều lần. Vui lòng thử lại sau 5 phút.")
    attempts.append(time.monotonic())
    if db.scalar(select(User.id).where(func.lower(User.email) == data.email)):
        raise HTTPException(409, "Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.")
    user = User(name=data.name, email=data.email, password_hash=passwords.hash(data.password), role="visitor")
    db.add(user)
    try:
        db.flush()
        return start_session(user, request, response, db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.")


@app.post("/api/v1/admin/auth/login")
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
    if request.url.path.startswith("/api/v1/admin/") and user.role == "visitor":
        raise HTTPException(403, "Tài khoản du khách không có quyền truy cập trang quản trị.")
    attempts.clear()
    return start_session(user, request, response, db)


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return user_data(user)


@app.get("/api/v1/admin/auth/me")
def admin_me(user: User = Depends(editors)):
    return user_data(user)


@app.post("/api/v1/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token and (session := db.get(Session, digest(token))):
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE, path="/")


@app.get("/api/v1/languages")
def public_languages(db: DbSession = Depends(get_db)):
    return [language_data(language) for language in languages(db, enabled_only=True)]


@app.get("/api/v1/admin/languages")
def admin_languages(db: DbSession = Depends(get_db), user: User = Depends(editors)):
    return [language_data(language) for language in languages(db)]


def save_language(db, user, data, existing=None):
    if (data.required and not data.enabled) or (data.code == "vi" and not (data.required and data.enabled)):
        raise HTTPException(422, "Ngôn ngữ bắt buộc phải được bật. Tiếng Việt luôn là ngôn ngữ mặc định.")
    if not existing and db.get(Language, data.code):
        raise HTTPException(409, "Mã ngôn ngữ đã tồn tại.")
    language = existing or Language(code=data.code)
    for key, value in data.model_dump().items():
        setattr(language, key, value)
    db.add(language)
    audit(db, user, None, "language_update" if existing else "language_create", data.code)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Mã ngôn ngữ đã tồn tại hoặc cấu hình không hợp lệ.")
    return language_data(language)


@app.post("/api/v1/admin/languages", status_code=201)
def create_language(
    data: LanguageInput, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))
):
    return save_language(db, user, data)


@app.put("/api/v1/admin/languages/{code}")
def update_language(
    code: str, data: LanguageInput, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))
):
    language = get_language(db, code)
    if data.code != code:
        raise HTTPException(422, "Không thể đổi mã ngôn ngữ đã tạo. Hãy thêm ngôn ngữ mới.")
    return save_language(db, user, data, language)


@app.get("/api/v1/admin/categories")
def categories(db: DbSession = Depends(get_db), user: User = Depends(editors)):
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
    sort: str = "views",
    page: int = Query(1, ge=1),
    page_size: int = Query(8, ge=1, le=100),
    db: DbSession = Depends(get_db),
    user: User = Depends(editors),
):
    query = select(Poi)
    if status:
        query = query.where(Poi.status == status)
    if category:
        query = query.where(Poi.category_id == category)
    ordering = Poi.name if sort == "name" else Poi.updated_at.desc() if sort == "updated" else Poi.view_count.desc()
    query = query.order_by(ordering, Poi.id.asc())
    pois = list(db.scalars(query))
    if q:
        pois = [p for p in pois if normalized(q.strip()) in normalized(p.name + " " + p.address)]
    return {
        "items": [serialize(p, db, statistics=user.role == "admin")
                  for p in pois[(page - 1) * page_size : page * page_size]],
        "total": len(pois),
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/v1/admin/summary")
def summary(db: DbSession = Depends(get_db), user: User = Depends(editors)):
    pois = list(db.scalars(select(Poi)))
    data = [serialize(p, db) for p in pois]
    required = [language.code for language in languages(db, enabled_only=True) if language.required]
    ready_count = sum(all(p["translations"][code]["tts_ready"] for code in required) for p in data)
    return {
        "total": len(data),
        "published": sum(p["has_published"] for p in data),
        "in_review": sum(p["status"] == "in_review" for p in data),
        "draft": sum(p["status"] == "draft" for p in data),
        "tts_ready": ready_count,
        "translations_ready": ready_count,
    }


def apply_input(poi: Poi, data: PoiInput, db: DbSession):
    if not data.name.strip() or not data.address.strip() or not db.get(Category, data.category_id):
        raise HTTPException(422, "Vui lòng nhập tên, địa chỉ và chọn danh mục hợp lệ.")
    for key in ("name", "address", "short_description", "category_id", "latitude", "longitude"):
        setattr(poi, key, getattr(data, key).strip()
                if key in ("name", "address", "short_description") else getattr(data, key))
    translations = dict(poi.translations or {})
    for locale, tr in data.translations.items():
        get_language(db, locale)
        translations[locale] = {"title": tr.title.strip(), "text": tr.text.strip()}
    poi.translations = translations
    if "source" in data.model_fields_set:
        poi.source = data.source.model_dump() if data.source else None


def save_visibility(db, poi, status):
    if status is None:
        return
    poi.status = status
    if status == "published":
        ready(poi, db)
    for release in db.scalars(select(Release).where(Release.poi_id == poi.id, Release.is_current.is_(True))):
        release.is_current = False
    if status == "published":
        snapshot = serialize(poi, db)
        snapshot["has_published"] = True
        db.add(Release(poi_id=poi.id, revision=poi.revision, snapshot=snapshot))
        if poi.image_id and (media := db.get(Media, poi.image_id)):
            media.is_public = True


@app.get("/api/v1/admin/map-search")
def map_search(q: str = Query(min_length=2, max_length=300), user: User = Depends(require("admin"))):
    return {"items": search_places(q)}


@app.get("/api/v1/admin/ai/status")
def ai_status(db: DbSession = Depends(get_db), user: User = Depends(editors)):
    return queue_status(db) if worker_mode() else {**ollama_status(), "mode": "direct"}


@app.post("/api/v1/admin/ai/wikipedia")
def wikipedia_preview(
    data: WikipediaImportInput, db: DbSession = Depends(get_db), user: User = Depends(editors)
):
    if worker_mode():
        raise HTTPException(409, "Hãy tạo yêu cầu AI qua hàng đợi.")
    payload, existing = prepare_import(db, data)
    if existing:
        return {"existing_poi": existing}
    result = generate_draft(data.url, payload["categories"], payload["languages"], article=payload["article"])
    result["existing_poi"] = None
    return result


@app.post("/api/v1/admin/pois/check-duplicates")
def check_duplicates(data: PoiInput, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    return {"items": find_duplicates(db, data.name, data.source.model_dump() if data.source else None)}


@app.post("/api/v1/admin/pois", status_code=201)
def create_poi(data: PoiInput, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))):
    ensure_unique(db, data.name, data.source.model_dump() if data.source else None)
    poi = Poi(id=uid(), translations={})
    apply_input(poi, data, db)
    db.add(poi)
    try:
        db.flush()
        save_visibility(db, poi, data.status)
        reserve_identities(db, poi)
        audit(db, user, poi, "create")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Địa điểm vừa được tạo ở phiên khác. Tìm địa điểm hiện có để kiểm tra.")
    return serialize(poi, db, statistics=True)


@app.get("/api/v1/admin/pois/{poi_id}")
def detail(poi_id: str, db: DbSession = Depends(get_db), user: User = Depends(editors)):
    return serialize(get_poi(db, poi_id), db, statistics=user.role == "admin")


@app.put("/api/v1/admin/pois/{poi_id}")
def update_poi(poi_id: str, data: PoiInput, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))):
    poi = get_poi(db, poi_id)
    check_revision(poi, data.revision)
    if poi.status in ("in_review", "archived") and data.status is None:
        raise HTTPException(409, "Hãy trả nội dung về bản nháp trước khi chỉnh sửa.")
    ensure_unique(db, data.name, data.source.model_dump() if data.source else None, poi.id)
    apply_input(poi, data, db)
    poi.status = "draft"
    touch(poi)
    save_visibility(db, poi, data.status or "draft")
    audit(db, user, poi, "update")
    try:
        reserve_identities(db, poi)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Địa điểm trùng với nội dung vừa được lưu ở phiên khác.")
    return serialize(poi, db, statistics=True)


@app.post("/api/v1/admin/pois/{poi_id}/actions")
def action(poi_id: str, data: ActionInput, db: DbSession = Depends(get_db), user: User = Depends(require("admin"))):
    poi = get_poi(db, poi_id)
    transition(db, poi, user, data)
    db.commit()
    return serialize(poi, db, statistics=True)


@app.get("/api/v1/admin/pois/{poi_id}/history")
def history(poi_id: str, db: DbSession = Depends(get_db), user: User = Depends(editors)):
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
            {
                "id": r.id,
                "revision": r.revision,
                "snapshot": text_snapshot(r.snapshot),
                "created_at": iso(r.created_at),
            }
            for r in db.scalars(
                select(Release).where(Release.poi_id == poi_id).order_by(Release.revision.desc())
            )
        ],
    }


@app.post("/api/v1/admin/pois/{poi_id}/upload")
async def upload(
    poi_id: str,
    file: UploadFile,
    kind: str = Query(pattern="^image$"),
    revision: int = Query(ge=1),
    db: DbSession = Depends(get_db),
    user: User = Depends(require("admin")),
):
    poi = get_poi(db, poi_id)
    check_revision(poi, revision)
    if poi.status in ("in_review", "archived"):
        raise HTTPException(409, "Nội dung cần ở trạng thái bản nháp để tải tệp.")
    limit = 10 * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(413, "Tệp quá lớn. Giới hạn 10 MB.")
    raw = bytes(data)
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
    if file.content_type != mime:
        raise HTTPException(422, "Định dạng bên trong tệp không khớp loại tệp đã gửi.")
    media_id = uid()
    filename = f"{media_id}.{ext}"
    path = MEDIA_ROOT / filename
    path.write_bytes(raw)
    media = Media(
        id=media_id,
        poi_id=poi.id,
        kind=kind,
        locale=None,
        filename=filename,
        mime=mime,
        size=len(raw),
        checksum=digest_bytes(raw),
    )
    db.add(media)
    db.flush()
    poi.image_id = media_id
    poi.status = "draft"
    touch(poi)
    audit(db, user, poi, "upload", "image")
    try:
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return serialize(poi, db, statistics=True)


def digest_bytes(value):
    import hashlib

    return hashlib.sha256(value).hexdigest()


@app.get("/api/v1/media/{media_id}")
def media_file(media_id: str, request: Request, db: DbSession = Depends(get_db)):
    media = db.get(Media, media_id)
    user = optional_user(request, db)
    if not media or (not media.is_public and (not user or user.role == "visitor")):
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
def public_pois(locale: str = Query("vi", max_length=35), db: DbSession = Depends(get_db)):
    get_language(db, locale, enabled_only=True)
    return {
        "items": [
            text_snapshot(r.snapshot)
            for r in db.scalars(
                select(Release).join(Poi, Poi.id == Release.poi_id)
                .where(Release.is_current.is_(True), Poi.status == "published")
                .order_by(Poi.view_count.desc(), Poi.id.asc())
            )
        ]
    }


@app.get("/api/v1/pois/{poi_id}")
def public_poi(poi_id: str, request: Request, locale: str = Query("vi", max_length=35),
               db: DbSession = Depends(get_db)):
    get_language(db, locale, enabled_only=True)
    release = db.scalar(select(Release).join(Poi, Poi.id == Release.poi_id).where(
        Release.poi_id == poi_id, Release.is_current.is_(True), Poi.status == "published"))
    if not release:
        raise HTTPException(404, "Địa điểm này chưa được xuất bản hoặc đã được lưu trữ.")
    snapshot = text_snapshot(release.snapshot)
    record(db, request, poi_id, "view")
    return snapshot


@app.post("/api/v1/pois/{poi_id}/events/{kind}", status_code=204)
def public_event(poi_id: str, kind: str, request: Request, db: DbSession = Depends(get_db)):
    if kind not in ("view", "listen"):
        raise HTTPException(422, "Sự kiện không hợp lệ.")
    if not db.scalar(select(Release.id).join(Poi, Poi.id == Release.poi_id).where(
        Release.poi_id == poi_id, Release.is_current.is_(True), Poi.status == "published")):
        raise HTTPException(404, "Địa điểm chưa được công bố.")
    record(db, request, poi_id, kind)


# Mount last so that authenticated APIs always take precedence over static files.
if os.getenv("STATIC_ROOT"):
    from .static_site import mount_site

    mount_site(app, os.environ["STATIC_ROOT"])

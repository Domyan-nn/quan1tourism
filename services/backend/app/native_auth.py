"""Visitor-only native sessions; browser cookies and their CSRF rules stay intact."""

import secrets
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from .auth import native_digest, native_token, optional_native_user, passwords
from .db import get_db
from .models import Session, User, now
from .schemas import Login, Register

router = APIRouter(prefix="/api/v1/native/auth", tags=["native-visitor-auth"])


def user_data(user: User):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


def limit_attempts(request: Request, *, registration=False):
    # Share the web endpoints' buckets so switching transports cannot bypass limits.
    # Import at request time to avoid the main module/router import cycle.
    from .main import login_attempts, registration_attempts

    buckets = registration_attempts if registration else login_attempts
    attempts = buckets[request.client.host if request.client else "local"]
    cutoff = time.monotonic() - 300
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(429, "Bạn đã thử nhiều lần. Vui lòng thử lại sau 5 phút.")
    attempts.append(time.monotonic())
    return attempts


def start_session(user: User, request: Request, db: DbSession):
    old = native_token(request)
    if old and (session := db.get(Session, native_digest(old))):
        db.delete(session)
    token = "q1n_" + secrets.token_urlsafe(48)
    expires_at = now() + timedelta(hours=8)
    db.add(Session(token_hash=native_digest(token), user_id=user.id, expires_at=expires_at))
    db.commit()
    return {"user": user_data(user), "access_token": token, "token_type": "Bearer",
            "expires_at": expires_at.isoformat()}


@router.post("/register", status_code=201)
def register(data: Register, request: Request, db: DbSession = Depends(get_db)):
    limit_attempts(request, registration=True)
    if db.scalar(select(User.id).where(func.lower(User.email) == data.email)):
        raise HTTPException(409, "Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.")
    user = User(name=data.name, email=data.email, password_hash=passwords.hash(data.password), role="visitor")
    db.add(user)
    try:
        db.flush()
        return start_session(user, request, db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.") from None


@router.post("/login")
def login(data: Login, request: Request, db: DbSession = Depends(get_db)):
    attempts = limit_attempts(request)
    user = db.scalar(select(User).where(User.email == data.email.strip().lower()))
    if not user or not passwords.verify(data.password, user.password_hash):
        raise HTTPException(401, "Email hoặc mật khẩu chưa đúng.")
    if user.role != "visitor":
        raise HTTPException(403, "Ứng dụng điện thoại chỉ hỗ trợ tài khoản du khách.")
    attempts.clear()
    return start_session(user, request, db)


def native_user(request: Request, db: DbSession = Depends(get_db)):
    user = optional_native_user(request, db)
    if not user:
        raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    return user


@router.get("/me")
def me(user: User = Depends(native_user)):
    return user_data(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = native_token(request)
    if token and (session := db.get(Session, native_digest(token))):
        db.delete(session)
        db.commit()

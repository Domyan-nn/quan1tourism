import hashlib
import os
import re
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from pwdlib import PasswordHash
from sqlalchemy.orm import Session as DbSession

from .db import get_db
from .models import Session, User

passwords = PasswordHash.recommended()
COOKIE = "quan1_session"
COOKIE_SECURE = os.getenv("APP_ENV") == "production" or os.getenv("COOKIE_SECURE", "false").lower() == "true"
NATIVE_TOKEN_PATTERN = re.compile(r"^q1n_[A-Za-z0-9_-]{64}$")


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def native_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    return token if scheme.lower() == "bearer" and NATIVE_TOKEN_PATTERN.fullmatch(token) else None


def native_digest(token: str) -> str:
    # Domain separation keeps native bearer credentials out of browser cookie sessions.
    return digest("native-visitor:" + token)


def session_user(session: Session | None, db: DbSession) -> User | None:
    if not session:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:  # SQLite returns naive UTC; PostgreSQL preserves its session timezone.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    return db.get(User, session.user_id)


def optional_native_user(request: Request, db: DbSession) -> User | None:
    token = native_token(request)
    user = session_user(db.get(Session, native_digest(token)) if token else None, db)
    return user if user and user.role == "visitor" else None


def optional_user(request: Request, db: DbSession) -> User | None:
    if getattr(request, "headers", {}).get("Authorization"):
        return optional_native_user(request, db)
    token = request.cookies.get(COOKIE)
    return session_user(db.get(Session, digest(token)) if token else None, db)


def current_user(request: Request, db: DbSession = Depends(get_db)):
    user = optional_user(request, db)
    if not user:
        raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    return user


def require(*roles: str):
    def check(user: User = Depends(current_user)):
        if user.role not in roles:
            raise HTTPException(403, "Tài khoản của bạn chưa có quyền thực hiện thao tác này.")
        return user

    return check

import hashlib
import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from pwdlib import PasswordHash
from sqlalchemy.orm import Session as DbSession

from .db import get_db
from .models import Session, User

passwords = PasswordHash.recommended()
COOKIE = "quan1_session"
COOKIE_SECURE = os.getenv("APP_ENV") == "production" or os.getenv("COOKIE_SECURE", "false").lower() == "true"


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def optional_user(request: Request, db: DbSession) -> User | None:
    token = request.cookies.get(COOKIE)
    session = db.get(Session, digest(token)) if token else None
    if not session:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:  # SQLite returns naive UTC; PostgreSQL preserves its session timezone.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    return db.get(User, session.user_id)


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

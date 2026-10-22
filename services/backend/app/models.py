import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def uid():
    return uuid.uuid4().hex


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20))
    __table_args__ = (CheckConstraint("role IN ('editor','reviewer','admin')", name="valid_role"),)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(20), default="green")


class Poi(Base):
    __tablename__ = "pois"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(180))
    address: Mapped[str] = mapped_column(String(300), default="")
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"), index=True)
    latitude: Mapped[float] = mapped_column(Float, default=10.7769)
    longitude: Mapped[float] = mapped_column(Float, default=106.7009)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    translations: Mapped[dict] = mapped_column(JSON, default=dict)
    image_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", use_alter=True, name="fk_poi_image"), nullable=True
    )
    cover: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    __mapper_args__ = {"version_id_col": revision, "version_id_generator": False}
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','in_review','approved','published','archived')", name="valid_status"
        ),
        CheckConstraint(
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="valid_coordinates"
        ),
    )


class Media(Base):
    __tablename__ = "media_assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    poi_id: Mapped[str] = mapped_column(ForeignKey("pois.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    locale: Mapped[str | None] = mapped_column(String(5), nullable=True)
    filename: Mapped[str] = mapped_column(String(120))
    mime: Mapped[str] = mapped_column(String(60))
    size: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64))
    text_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Release(Base):
    __tablename__ = "content_releases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    poi_id: Mapped[str] = mapped_column(ForeignKey("pois.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("poi_id", "revision", name="unique_release_revision"),)


class Audit(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    poi_id: Mapped[str | None] = mapped_column(ForeignKey("pois.id"), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    BigInteger,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    __table_args__ = (CheckConstraint("role IN ('visitor','editor','reviewer','admin')", name="valid_role"),)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    name_vi: Mapped[str | None] = mapped_column(String(100), nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="green")


class Language(Base):
    __tablename__ = "languages"
    code: Mapped[str] = mapped_column(String(35), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    native_name: Mapped[str] = mapped_column(String(100))
    speech_locale: Mapped[str] = mapped_column(String(35))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    direction: Mapped[str] = mapped_column(String(3), default="ltr")
    __table_args__ = (
        CheckConstraint("direction IN ('ltr','rtl')", name="valid_language_direction"),
        CheckConstraint("NOT required OR enabled", name="required_language_enabled"),
        CheckConstraint("code != 'vi' OR (enabled AND required)", name="default_language_enabled"),
    )


class Poi(Base):
    __tablename__ = "pois"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(180))
    address: Mapped[str] = mapped_column(String(300), default="")
    short_description: Mapped[str] = mapped_column(Text, default="", server_default="")
    view_count: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    listen_count: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"), index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    trigger_radius_m: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    auto_narration_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    narration_meta: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    translation_rows: Mapped[list["PoiTranslation"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )
    image_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", use_alter=True, name="fk_poi_image"), nullable=True
    )
    cover: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    __mapper_args__ = {"version_id_col": revision, "version_id_generator": False}
    __table_args__ = (
        CheckConstraint("trigger_radius_m BETWEEN 20 AND 1000", name="valid_trigger_radius"),
        CheckConstraint("NOT auto_narration_enabled OR (latitude IS NOT NULL AND longitude IS NOT NULL)",
                        name="auto_narration_coordinates"),
        CheckConstraint("view_count >= 0 AND listen_count >= 0", name="nonnegative_poi_statistics"),
        CheckConstraint(
            "status IN ('draft','in_review','approved','published','archived')", name="valid_status"
        ),
        CheckConstraint(
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="valid_coordinates"
        ),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)",
            name="coordinate_pair",
        ),
    )

    @property
    def translations(self):
        return {row.locale: {"title": row.title, "text": row.text} for row in self.translation_rows}

    @translations.setter
    def translations(self, values):
        existing = {row.locale: row for row in self.translation_rows}
        rows = []
        for locale, value in values.items():
            row = existing.get(locale) or PoiTranslation(locale=locale)
            row.title = value.get("title", "")
            row.text = value.get("text", "")
            rows.append(row)
        self.translation_rows = rows


class PoiEngagement(Base):
    __tablename__ = "poi_engagements"
    session_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    poi_id: Mapped[str] = mapped_column(ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(6), primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (CheckConstraint("kind IN ('view','listen')", name="valid_engagement_kind"),)


class PoiTranslation(Base):
    __tablename__ = "poi_translations"
    poi_id: Mapped[str] = mapped_column(ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True)
    locale: Mapped[str] = mapped_column(ForeignKey("languages.code"), primary_key=True)
    title: Mapped[str] = mapped_column(String(180), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    __table_args__ = (CheckConstraint("length(text) <= 30000", name="narration_text_length"),)


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


class PoiIdentity(Base):
    __tablename__ = "poi_identities"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    poi_id: Mapped[str] = mapped_column(ForeignKey("pois.id", ondelete="CASCADE"), index=True)


class AiJob(Base):
    __tablename__ = "ai_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','completed','failed')", name="valid_ai_job_status"),
    )


class AiWorker(Base):
    __tablename__ = "ai_workers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    model: Mapped[str] = mapped_column(String(100))
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    protocol: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

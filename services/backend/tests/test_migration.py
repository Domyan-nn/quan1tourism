from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import MetaData, create_engine, inspect, select
from sqlalchemy.orm import Session

from app.content import text_snapshot
from app.db import Base
from app.models import Poi, Release, now


def test_upgrade_preserves_unicode_accounts_sessions_images_and_historical_releases(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    monkeypatch.setattr("app.db.engine", engine)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, "0002")
    metadata = MetaData()
    metadata.reflect(engine)
    values = {
        "vi": {"title": "Sài Gòn", "text": "Xin chào Việt Nam.", "audio_id": "legacy-audio"},
        "en": {"title": "Saigon", "text": "Welcome to Saigon."},
        "ms": {"title": "Kisah", "text": "Selamat datang."},
    }
    snapshot = {"translations": values, "name": "Sài Gòn"}
    with engine.begin() as connection:
        connection.execute(
            metadata.tables["users"]
            .insert()
            .values(id="user", email="admin@test.local", name="Admin", password_hash="test", role="admin")
        )
        connection.execute(
            metadata.tables["sessions"]
            .insert()
            .values(token_hash="session", user_id="user", expires_at=now())
        )
        connection.execute(
            metadata.tables["categories"].insert().values(id="category", name="Di tích", color="green")
        )
        connection.execute(
            metadata.tables["pois"]
            .insert()
            .values(
                id="poi",
                name="Sài Gòn",
                address="Quận 1",
                category_id="category",
                latitude=10.7,
                longitude=106.7,
                status="published",
                revision=5,
                updated_at=now(),
                translations=values,
                image_id=None,
                cover=0,
                note="",
                is_demo=False,
            )
        )
        connection.execute(
            metadata.tables["media_assets"]
            .insert()
            .values(
                id="image",
                poi_id="poi",
                kind="image",
                locale=None,
                filename="image.png",
                mime="image/png",
                size=100,
                checksum="test",
                text_hash=None,
                duration=None,
                is_public=True,
                created_at=now(),
            )
        )
        connection.execute(metadata.tables["pois"].update().values(image_id="image"))
        connection.execute(
            metadata.tables["content_releases"]
            .insert()
            .values(
                id="release", poi_id="poi", revision=5, snapshot=snapshot, is_current=True, created_at=now()
            )
        )
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with Session(engine) as db:
        poi = db.get(Poi, "poi")
        assert poi.translations["vi"] == {"title": "Sài Gòn", "text": "Xin chào Việt Nam."}
        assert poi.translations["ms"]["text"] == "Selamat datang."
        assert poi.image_id == "image" and poi.revision == 5
        release = db.scalar(select(Release))
        assert release.snapshot == snapshot  # Immutable historical evidence is retained.
        assert text_snapshot(release.snapshot)["translations"]["vi"] == {
            "title": "Sài Gòn",
            "text": "Xin chào Việt Nam.",
            "tts_ready": True,
        }
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("SELECT user_id FROM sessions").scalar() == "user"
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    assert "translations" not in {column["name"] for column in inspect(engine).get_columns("pois")}
    engine.dispose()

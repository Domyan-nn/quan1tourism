"""Real database migration rehearsals; never accepts a remote database URL."""
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import MetaData, inspect

from app.db import Base
from app.models import now
from app.release import SCHEMA_REVISION


@pytest.fixture(autouse=True)
def require_postgres(request):
    if not request.config.getoption("--postgres"):
        pytest.skip("Explicit --postgres required")


@pytest.mark.parametrize("start", ["base", "0007", "0008", "0009", "0010"])
def test_empty_and_previous_revision_preserve_all_data(postgres_engine, monkeypatch, start):
    engine = postgres_engine
    monkeypatch.setattr("app.db.engine", engine)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, start)
    old = MetaData()
    old.reflect(engine)
    stamp = now()
    source = {"url": "https://vi.wikipedia.org/wiki/Test", "revision": 42}
    if start != "base":
        rows = {
            "users": dict(id="user", email="admin@test.local", name="Admin", password_hash="synthetic", role="admin"),
            "sessions": dict(token_hash="session", user_id="user", expires_at=stamp),
            "categories": dict(id="category", name="Di tích", color="green"),
            "pois": dict(id="poi", name="Sài Gòn", address="Quận 1", category_id="category", latitude=10.7,
                         longitude=106.7, status="published", revision=5, updated_at=stamp, source=source,
                         image_id=None, cover=0, note="Ghi chú", is_demo=False),
            "poi_translations": dict(poi_id="poi", locale="vi", title="Sài Gòn", text="Xin chào Việt Nam."),
            "media_assets": dict(id="image", poi_id="poi", kind="image", locale=None, filename="image.png",
                                 mime="image/png", size=100, checksum="synthetic", text_hash=None, duration=None,
                                 is_public=True, created_at=stamp),
            "content_releases": dict(id="release", poi_id="poi", revision=5, snapshot={"name": "Sài Gòn",
                                     "translations": {"vi": {"text": "Lịch sử."}}, "source": source},
                                     is_current=True, created_at=stamp),
            "audit_logs": dict(id=1, poi_id="poi", actor="Admin", action="publish", detail="", created_at=stamp),
            "poi_identities": dict(key="identity", poi_id="poi"),
            "ai_jobs": dict(id="job", requested_by="user", status="running", payload={"article": source},
                            result=None, error="", attempts=1, lease_hash="synthetic", lease_until=stamp,
                            created_at=stamp, updated_at=stamp),
            "ai_workers": dict(id="local", model="test-model", ready=False, seen_at=stamp, token_hash="synthetic"),
        }
        with engine.begin() as connection:
            for table, values in rows.items():
                connection.execute(old.tables[table].insert().values(**values))
            connection.execute(old.tables["pois"].update().values(image_id="image"))
            if start in {"0008", "0009", "0010"}:
                connection.execute(old.tables["pois"].update().values(view_count=17, listen_count=9))
                connection.execute(old.tables["poi_engagements"].insert().values(
                    session_hash="synthetic", poi_id="poi", kind="listen", recorded_at=stamp))
    with engine.connect() as connection:
        before = {name: connection.execute(table.select()).mappings().all()
                  for name, table in old.tables.items() if name != "alembic_version"}
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with engine.connect() as connection:
        print("PostgreSQL rehearsal:", connection.exec_driver_sql("SHOW server_version").scalar(), start, "->", SCHEMA_REVISION)
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar() == SCHEMA_REVISION
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        # Execute previous revision's projections on the expanded schema, including leases/media/sessions.
        for name, records in before.items():
            assert connection.execute(old.tables[name].select()).mappings().all() == records
        if start != "base":
            assert connection.exec_driver_sql("SELECT view_count, listen_count FROM pois").one() == ((17, 9) if start in {"0008", "0009", "0010"} else (0, 0))
            assert connection.exec_driver_sql("SELECT trigger_radius_m, auto_narration_enabled, narration_meta FROM pois").one() == (100, False, {})
        assert connection.exec_driver_sql(
            "SELECT count(*) FROM pg_class WHERE relnamespace = current_schema()::regnamespace "
            "AND relname IN ('pois','ai_jobs','sessions','poi_engagements','site_visit_sessions','site_visit_daily') "
            "AND relrowsecurity"
        ).scalar() == 6
    assert "display_order" not in {c["name"] for c in inspect(engine).get_columns("pois")}


def test_release_migration_lock_and_idempotent_retry(postgres_engine, monkeypatch, tmp_path):
    from test_release_control import load
    from sqlalchemy import text

    release = load("release_migrate")
    engine = postgres_engine
    monkeypatch.setattr(release, "create_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr("app.db.engine", engine)
    with engine.connect() as holder:
        holder.execute(text("SELECT pg_advisory_lock(:key)"), {"key": release.LOCK_ID})
        holder.commit()
        try:
            with pytest.raises(RuntimeError, match="Another migration"):
                release.migrate("unused", "a" * 40, "synthetic-backup")
        finally:
            holder.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": release.LOCK_ID})
            holder.commit()
    result = release.migrate("unused", "a" * 40, "synthetic-backup", tmp_path / "progress.json")
    assert result["revision_before"] == "base" and result["revision_after"] == SCHEMA_REVISION
    result = release.migrate("unused", "a" * 40, "synthetic-backup")
    assert result["revision_before"] == result["revision_after"] == SCHEMA_REVISION

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.release import SCHEMA_REVISION, WORKER_PROTOCOL


def test_shared_release_metadata_matches_the_only_alembic_head():
    backend = Path(__file__).parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    assert ScriptDirectory.from_config(config).get_heads() == [SCHEMA_REVISION]
    assert WORKER_PROTOCOL == 3


def test_readiness_rejects_database_at_another_revision(env):
    from sqlalchemy import text

    client, factory, _ = env
    with factory() as db:
        db.execute(text("UPDATE alembic_version SET version_num = 'previous'"))
        db.commit()
    assert client.get("/api/v1/health/ready").status_code == 503
    assert client.get("/api/v1/version").json()["schema_revision"] == SCHEMA_REVISION

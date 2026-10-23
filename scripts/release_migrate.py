"""One migration owner, PostgreSQL advisory lock; no seed, downgrade or restore."""
import argparse
import json
import os
from pathlib import Path
import re
import sys

BACKEND = Path(__file__).resolve().parents[1] / "services/backend"
sys.path.insert(0, str(BACKEND))
os.environ["QUAN1_IGNORE_LOCAL_ENV"] = "1"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, inspect, text  # noqa: E402
from app.config import database_url  # noqa: E402

LOCK_ID = 716103045  # Stable across releases/runners; database-scoped session lock.


def migrate(url, release, backup_reference, output=None):
    engine = create_engine(url, hide_parameters=True, connect_args={"connect_timeout": 15, "prepare_threshold": None})
    try:
        with engine.connect() as connection:
            if not connection.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_ID}):
                raise RuntimeError("Another migration owns the database lock; stop and inspect that release.")
            connection.commit()
            try:
                connection.execute(text("SET lock_timeout = '15s'"))
                connection.execute(text("SET statement_timeout = '10min'"))
                before = (connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
                          if inspect(connection).has_table("alembic_version") else "base")
                connection.commit()
                if output:
                    Path(output).write_text(json.dumps({"release": release, "backup_reference": backup_reference,
                                           "revision_before": before, "status": "in_progress"}) + "\n")
                config = Config(str(BACKEND / "alembic.ini"))
                config.set_main_option("script_location", str(BACKEND / "migrations"))
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
                after = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
                connection.commit()
                return {"release": release, "backup_reference": backup_reference,
                        "revision_before": before, "revision_after": after}
            finally:
                connection.rollback()
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_ID})
                connection.commit()
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    release, backup = os.getenv("RELEASE_SHA", ""), os.getenv("BACKUP_REFERENCE", "")
    if not re.fullmatch(r"[0-9a-f]{40}", release) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{3,200}", backup):
        raise RuntimeError("Require full RELEASE_SHA and an opaque backup inventory reference (no signed URL).")
    if os.getenv("MIGRATION_APPROVED") != "true":
        raise RuntimeError("Migration requires the environment's backup/schema review attestation.")
    url = database_url(os.environ.get("DATABASE_URL", ""), production=True)
    result = migrate(url, release, backup, args.output)
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("Migration completed; revision evidence saved.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # DB exceptions can contain DSNs/SQL parameter values. Do not print or upload them.
        sys.exit("Migration failed. Inspect the restricted database logs; do not retry or downgrade blindly.")

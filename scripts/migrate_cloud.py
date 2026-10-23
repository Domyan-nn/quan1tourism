"""Back up public application schema, verify the archive, then migrate the configured Supabase DB."""

import argparse
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "services" / "backend"
sys.path.insert(0, str(BACKEND))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app.db import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402


def migrate(project):
    url = engine.url
    if not (project in (url.host or "") or project in (url.username or "")):
        raise RuntimeError("Configured database does not match the expected Supabase project.")
    executable = shutil.which("pg_dump")
    if not executable:
        executable = str(Path("C:/Program Files/PostgreSQL/18/bin/pg_dump.exe"))
    if not Path(executable).is_file():
        raise RuntimeError("Install PostgreSQL client tools before migrating production.")
    restore = str(Path(executable).with_name("pg_restore.exe" if os.name == "nt" else "pg_restore"))
    destination = ROOT / ".runtime" / "backups" / (
        "supabase-public-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".dump"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PGHOST": url.host, "PGPORT": str(url.port or 5432),
           "PGUSER": url.username, "PGPASSWORD": url.password, "PGDATABASE": url.database,
           "PGSSLMODE": url.query.get("sslmode", "require"), "PGCONNECT_TIMEOUT": "15"}
    backup = subprocess.run([executable, "--schema=public", "--format=custom", "--no-owner", "--no-acl",
                             "--file", str(destination)], env=env, capture_output=True)
    if backup.returncode:
        raise RuntimeError("Database backup failed. Migration was not started; no credentials were logged.")
    verified = subprocess.run([restore, "--list", str(destination)], capture_output=True)
    if verified.returncode or not verified.stdout or destination.stat().st_size == 0:
        raise RuntimeError("Backup archive verification failed. Migration was not started.")
    print("Verified application backup:", destination, flush=True)
    settings = Config(str(BACKEND / "alembic.ini"))
    settings.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(settings, "head")
    with engine.connect() as connection:
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        print("Database migration applied:", revision)
        print("Private application tables protected with RLS:", connection.execute(text(
            "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity "
            "AND tablename IN ('users','sessions','pois','ai_jobs','poi_identities')"
        )).scalar())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Expected Supabase project reference")
    args = parser.parse_args()
    try:
        migrate(args.project)
    except Exception as exc:
        # SQL/driver errors can contain private connection parameters and row data.
        print("Migration did not complete:", str(exc) if type(exc) is RuntimeError else type(exc).__name__)
        sys.exit(1)

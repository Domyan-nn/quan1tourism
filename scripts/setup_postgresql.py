"""Create/migrate PostgreSQL and preserve the existing local SQLite data."""

import argparse
import os
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "services" / "backend"
sys.path.insert(0, str(BACKEND))

import psycopg
from app.config import LOCAL_ENV, RUNTIME
from psycopg import sql
from sqlalchemy import MetaData, create_engine, func, select, text
from sqlalchemy.engine import make_url


def save_configuration(url):
    RUNTIME.mkdir(exist_ok=True)
    lines = (
        LOCAL_ENV.read_text(encoding="utf-8-sig").splitlines()
        if LOCAL_ENV.exists()
        else []
    )
    lines = [line for line in lines if not line.strip().startswith("DATABASE_URL=")]
    lines.append("DATABASE_URL=" + url.render_as_string(hide_password=False))
    if not any(line.startswith("OLLAMA_MODEL=") for line in lines):
        lines.append("OLLAMA_MODEL=qwen3:4b")
    LOCAL_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def copy_sqlite(target_engine, source_path):
    source_engine = create_engine(f"sqlite:///{source_path.as_posix()}")
    source_meta, target_meta = MetaData(), MetaData()
    source_meta.reflect(source_engine)
    target_meta.reflect(target_engine)
    order = [
        "users",
        "categories",
        "languages",
        "pois",
        "media_assets",
        "poi_translations",
        "sessions",
        "content_releases",
        "audit_logs",
    ]
    counts = {}
    try:
        with source_engine.connect() as source, target_engine.begin() as target:
            occupied = any(
                target.scalar(
                    select(func.count()).select_from(target_meta.tables[name])
                )
                for name in order
                if name != "languages"
            )
            if occupied:
                print(
                    "PostgreSQL already contains application data; SQLite import skipped (no rows overwritten)."
                )
                return
            deferred_images = []
            for name in order:
                if name not in source_meta.tables:
                    continue
                destination = target_meta.tables[name]
                rows = [
                    dict(row)
                    for row in source.execute(
                        select(source_meta.tables[name])
                    ).mappings()
                ]
                for row in rows:
                    row = {
                        key: value for key, value in row.items() if key in destination.c
                    }
                    for key, value in row.items():
                        if isinstance(value, datetime) and value.tzinfo is None:
                            row[key] = value.replace(tzinfo=UTC)
                    if name == "pois" and row.get("image_id"):
                        deferred_images.append((row["id"], row["image_id"]))
                        row["image_id"] = None
                    if name == "languages" and target.scalar(
                        select(destination.c.code).where(
                            destination.c.code == row["code"]
                        )
                    ):
                        target.execute(
                            destination.update()
                            .where(destination.c.code == row["code"])
                            .values(**row)
                        )
                    else:
                        target.execute(destination.insert().values(**row))
                counts[name] = len(rows)
            pois = target_meta.tables["pois"]
            for poi_id, image_id in deferred_images:
                target.execute(
                    pois.update().where(pois.c.id == poi_id).values(image_id=image_id)
                )
            target.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence('audit_logs','id'), "
                    "GREATEST(COALESCE((SELECT max(id) FROM audit_logs), 1), 1), "
                    "EXISTS(SELECT 1 FROM audit_logs))"
                )
            )
        print(
            "SQLite imported atomically: "
            + ", ".join(f"{name}={count}" for name, count in counts.items())
        )
    finally:
        source_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="quan1tourism")
    parser.add_argument("--import-sqlite", action="store_true")
    parser.add_argument("--seed-demo", action="store_true")
    args = parser.parse_args()
    raw = os.getenv("DATABASE_URL")
    if not raw or not raw.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError(
            "Set DATABASE_URL for PostgreSQL in .runtime/local.env or the shell first. Never put passwords in command arguments."
        )
    url = make_url(raw).set(drivername="postgresql+psycopg", database=args.database)
    if not args.database or len(args.database) > 63:
        raise RuntimeError("Database name must have 1-63 characters.")
    with psycopg.connect(
        host=url.host or "127.0.0.1",
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname="postgres",
        autocommit=True,
        connect_timeout=5,
    ) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (args.database,)
        ).fetchone()
        if not exists:
            connection.execute(
                sql.SQL("CREATE DATABASE {} ENCODING 'UTF8' TEMPLATE template0").format(
                    sql.Identifier(args.database)
                )
            )
            print("Created database " + args.database)
        else:
            print("Using existing database " + args.database)
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
    from alembic import command
    from alembic.config import Config
    from app.db import engine

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(config, "head")
    source = RUNTIME / "quan1.db"
    if args.import_sqlite and source.is_file():
        backups = RUNTIME / "backups"
        backups.mkdir(exist_ok=True)
        backup = backups / (
            "quan1-before-postgresql-"
            + datetime.now().strftime("%Y%m%d-%H%M%S")
            + ".db"
        )
        with (
            sqlite3.connect(source) as original,
            sqlite3.connect(backup) as destination,
        ):
            original.backup(destination)
        copy_sqlite(engine, backup)
    if args.seed_demo:
        from app.seed import seed

        seed()
    with engine.connect() as connection:
        tables = (
            connection.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
                )
            )
            .scalars()
            .all()
        )
        revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar()
        print("Migration: " + revision + "; tables: " + ", ".join(tables))
    save_configuration(url)
    engine.dispose()
    print(
        "Configuration saved to .runtime/local.env (gitignored). Restart the backend to use PostgreSQL."
    )


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as exc:
        print(
            "PostgreSQL setup failed: "
            + (exc.diag.message_primary or "connection/authentication failed"),
            file=sys.stderr,
        )
        sys.exit(1)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

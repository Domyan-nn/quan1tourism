"""Read-only deployment checks. Never print a database URL, credentials or response bodies."""

import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "backend"))

from sqlalchemy import inspect, text  # noqa: E402
from app.db import engine  # noqa: E402


def main():
    failed = False
    try:
        with engine.connect() as connection:
            names = inspect(connection).get_table_names()
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar() \
                if "alembic_version" in names else "not initialized"
            print("Database: connected; dialect:", connection.dialect.name, "migration:", revision)
            print("Supabase project matches:", "nqsfgcisjackuhgiksmu" in str(engine.url.host)
                  or "nqsfgcisjackuhgiksmu" in str(engine.url.username))
            if "pois" in names:
                print("Places:", connection.execute(text("SELECT count(*) FROM pois")).scalar())
            if "users" in names:
                print("Administrator accounts:", connection.execute(text("SELECT count(*) FROM users WHERE role='admin'")).scalar())
            print("Categories:", connection.execute(text("SELECT count(*) FROM categories")).scalar()
                  if "categories" in names else 0)
    except Exception as exc:
        message = str(exc).lower()
        reason = next((label for token, label in (
            ("password authentication failed", "authentication failed"),
            ("could not translate", "DNS lookup failed"),
            ("getaddrinfo", "DNS lookup failed"),
            ("timed out", "connection timeout"),
            ("refused", "connection refused"),
        ) if token in message), type(exc).__name__)
        print("Database check failed:", reason)
        failed = True
    try:
        with urlopen("https://quan1-tourism-api.onrender.com/api/v1/health/ready", timeout=50) as response:
            print("Render readiness HTTP:", response.status)
    except Exception as exc:
        print("Render check failed:", type(exc).__name__, getattr(exc, "code", ""))
        failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())

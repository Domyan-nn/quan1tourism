"""Local configuration; shell variables always take precedence."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / ".runtime"
LOCAL_ENV = RUNTIME / "local.env"


def load_local_environment():
    if os.getenv("QUAN1_IGNORE_LOCAL_ENV") == "1":
        return
    if LOCAL_ENV.is_file():
        for line in LOCAL_ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key in {
                "DATABASE_URL", "MEDIA_ROOT", "COOKIE_SECURE", "OLLAMA_BASE_URL", "OLLAMA_MODEL",
                "APP_ENV", "AI_MODE", "AI_WORKER_TOKEN", "AI_SERVER_URL", "STATIC_ROOT", "GEOCODING_URL",
                "AI_TRANSLATION_BATCH_LIMIT", "AI_TRANSLATION_VERIFIED_LOCALES", "AI_TRANSLATION_ENABLED",
                "AI_TRANSLATION_PENDING_LIMIT", "AI_GENERATION_TIMEOUT_SECONDS",
                "MEDIA_STORAGE_DRIVER", "SUPABASE_URL", "SUPABASE_STORAGE_BUCKET",
                "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            }:
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ.setdefault(key, value)


load_local_environment()

# Render sets RENDER=true on its services, including an existing native Python
# service whose environment predates APP_ENV. Never target localhost Ollama there.
if os.getenv("RENDER") == "true":
    os.environ["APP_ENV"] = "production"


def database_url(value=None, *, production=None):
    """Accept Supabase's URI with psycopg 3, and never silently use SQLite in production."""
    production = os.getenv("APP_ENV") == "production" if production is None else production
    value = value if value is not None else os.getenv("DATABASE_URL", "")
    if value.startswith(("postgres://", "postgresql://")):
        value = "postgresql+psycopg://" + value.split("://", 1)[1]
    if production and not value.startswith("postgresql+psycopg://"):
        raise RuntimeError("Production requires a PostgreSQL DATABASE_URL (set it in Render secrets).")
    if production:
        from sqlalchemy.engine import make_url

        parsed = make_url(value)
        if parsed.query.get("sslmode", "require") not in {"require", "verify-ca", "verify-full"}:
            raise RuntimeError("Production DATABASE_URL must require TLS.")
        value = parsed.update_query_dict({"sslmode": parsed.query.get("sslmode", "require")}).render_as_string(
            hide_password=False
        )
    return value or f"sqlite:///{(RUNTIME / 'quan1.db').as_posix()}"

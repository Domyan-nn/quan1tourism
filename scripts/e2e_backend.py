"""Start an isolated, disposable backend for browser tests. Never uses normal local data."""

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "services" / "backend"
sys.path.insert(0, str(BACKEND))


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="quan1-e2e-") as directory:
        os.environ["DATABASE_URL"] = f"sqlite:///{Path(directory).as_posix()}/test.db"
        os.environ["MEDIA_ROOT"] = str(Path(directory) / "media")
        os.environ["QUAN1_IGNORE_LOCAL_ENV"] = "1"
        os.environ["APP_ENV"] = "test"
        os.environ["COOKIE_SECURE"] = "false"
        os.environ["AI_MODE"] = "worker"
        os.environ["AI_WORKER_TOKEN"] = "isolated-e2e-worker-credential-only"
        os.environ.pop("RENDER", None)
        os.environ.pop("STATIC_ROOT", None)
        import uvicorn
        from alembic import command
        from alembic.config import Config
        from app.seed import seed

        config = Config(str(BACKEND / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND / "migrations"))
        command.upgrade(config, "head")
        seed()
        uvicorn.run("app.main:app", host="127.0.0.1", port=8010, log_level="warning")

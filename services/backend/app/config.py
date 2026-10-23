"""Local configuration; shell variables always take precedence."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / ".runtime"
LOCAL_ENV = RUNTIME / "local.env"


def load_local_environment():
    if LOCAL_ENV.is_file():
        for line in LOCAL_ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key in {"DATABASE_URL", "MEDIA_ROOT", "COOKIE_SECURE", "OLLAMA_BASE_URL", "OLLAMA_MODEL"}:
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ.setdefault(key, value)


load_local_environment()

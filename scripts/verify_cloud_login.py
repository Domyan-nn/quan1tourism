"""Verify the configured initial admin against Render, without printing credentials/cookies."""

import json
import sys
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "backend"))
from app.config import RUNTIME  # noqa: E402
from app.wikipedia import NoRedirects  # noqa: E402

ORIGIN = "https://quan1-tourism-api.onrender.com"


def main():
    credentials = json.loads((RUNTIME / "initial-admin.json").read_text(encoding="utf-8"))
    cookies = CookieJar()
    opener = build_opener(NoRedirects(), HTTPCookieProcessor(cookies))
    headers = {"Content-Type": "application/json", "X-Requested-With": "Quan1Admin"}
    try:
        login = Request(ORIGIN + "/api/v1/admin/auth/login", data=json.dumps(credentials).encode(), headers=headers)
        with opener.open(login, timeout=50) as response:
            user = json.loads(response.read())
            print("Render administrator login HTTP:", response.status, "role:", user.get("role"))
        with opener.open(ORIGIN + "/api/v1/admin/auth/me", timeout=30) as response:
            print("Authenticated session HTTP:", response.status)
        with opener.open(ORIGIN + "/openapi.json", timeout=30) as response:
            paths = json.loads(response.read()).get("paths", {})
            print("Cloud worker endpoints deployed:", "/api/v1/worker/claim" in paths)
    except Exception as exc:
        print("Cloud login check failed:", type(exc).__name__, getattr(exc, "code", ""))
        return 1
    finally:
        try:
            opener.open(Request(ORIGIN + "/api/v1/auth/logout", data=b"{}", headers=headers), timeout=15).close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

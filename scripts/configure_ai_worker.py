"""Prepare local AI worker settings without printing the shared credential."""

import argparse
import secrets
import json
from http.cookiejar import CookieJar
from urllib.request import Request, build_opener, HTTPCookieProcessor

from ollama_worker import server_url
from app.config import LOCAL_ENV, RUNTIME
from app.wikipedia import NoRedirects


def configure(origin, pair=False):
    origin = server_url(origin)
    lines = LOCAL_ENV.read_text(encoding="utf-8-sig").splitlines() if LOCAL_ENV.is_file() else []
    settings = dict(line.split("=", 1) for line in lines if line and not line.startswith("#") and "=" in line)
    token = settings.get("AI_WORKER_TOKEN", "").strip().strip("\"'")
    if len(token) < 32:
        token = secrets.token_urlsafe(48)
    lines = [line for line in lines if not line.startswith(("AI_SERVER_URL=", "AI_WORKER_TOKEN="))]
    RUNTIME.mkdir(exist_ok=True)
    LOCAL_ENV.write_text("\n".join([*lines, "AI_SERVER_URL=" + origin, "AI_WORKER_TOKEN=" + token]) + "\n",
                         encoding="utf-8")
    print("Local settings saved to .runtime/local.env.")
    if pair:
        credentials = json.loads((RUNTIME / "initial-admin.json").read_text(encoding="utf-8"))
        opener = build_opener(NoRedirects(), HTTPCookieProcessor(CookieJar()))
        headers = {"Content-Type": "application/json", "X-Requested-With": "Quan1Admin"}
        def post(path, value):
            request = Request(origin + "/api/v1" + path, data=json.dumps(value).encode(), headers=headers)
            with opener.open(request, timeout=50) as response:
                return json.loads(response.read() or "null")
        try:
            post("/admin/auth/login", credentials)
            post("/admin/ai/worker-key", {"token": token})
            print("Worker paired. The server stores only the credential hash.")
        finally:
            post("/auth/logout", {})
    else:
        print("Pair with --pair after deployment, or set the same AI_WORKER_TOKEN in Render secrets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True)
    parser.add_argument("--pair", action="store_true", help="Pair via administrator API using local initial-admin.json")
    args = parser.parse_args()
    try:
        configure(args.server, args.pair)
    except Exception as exc:
        print("Worker pairing failed:", type(exc).__name__, getattr(exc, "code", ""))
        raise SystemExit(1)

"""Validate environment identities before the first cloud write; never print a DSN."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url


def database_identity(value):
    url = make_url(value)
    if url.get_backend_name() not in {"postgres", "postgresql"}:
        raise ValueError("PostgreSQL required")
    # A Supabase pooler shares host/database between projects, so include username.
    parts = [url.host, url.port or 5432, url.database, url.username]
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()


def validate(environment):
    if environment.get("RELEASE_ENVIRONMENT") not in {"staging", "production"}:
        raise ValueError("Unknown environment")
    production = environment["RELEASE_ENVIRONMENT"] == "production"
    identity = database_identity(environment["DATABASE_URL"])
    if identity != environment["DATABASE_IDENTITY"]:
        raise ValueError("Database identity differs from the reviewed environment")
    comparisons = [(identity, environment["PRODUCTION_DATABASE_IDENTITY"])]
    for key in ("BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "WORKER_NAME"):
        local_key = "CLOUDFLARE_WORKER_NAME" if key == "WORKER_NAME" else key
        left, right = environment[local_key], environment["PRODUCTION_" + key]
        if not left or not right:
            raise ValueError("Missing reviewed resource identity")
        if key.endswith("ORIGIN"):
            for value in (left, right):
                parsed = urlsplit(value)
                if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                    raise ValueError("HTTPS origins required")
            left, right = left.rstrip("/"), right.rstrip("/")
        comparisons.append((left, right))
    if any((left == right) != production for left, right in comparisons):
        raise ValueError("Staging and production resources must be separate; production must match its inventory")
    if environment.get("MIGRATION_APPROVED") != "true" or not re.fullmatch(
        r"[A-Za-z0-9_.:/-]{3,200}", environment.get("BACKUP_REFERENCE", "")
    ):
        raise ValueError("Backup/schema compatibility review required")


def main():
    if sys.argv[1:] == ["--database-identity"]:
        print(database_identity(os.environ["DATABASE_URL"]))
        return
    validate(os.environ)
    if os.environ["RELEASE_ENVIRONMENT"] == "production":
        staging = json.loads(Path(".runtime/staging/receipt.json").read_text())
        digest = hashlib.sha256(Path(".runtime/release/manifest.json").read_bytes()).hexdigest()
        if (staging["bundle_sha256"] != digest or staging["release"] != os.environ["RELEASE_SHA"]
                or str(staging["ci_run_id"]) != os.environ["CI_RUN_ID"]):
            raise ValueError("Staging verified a different artifact")
    print("Environment isolation and release preflight passed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit("Preflight failed: check resource identities, backup/schema review and staging evidence. No credentials emitted.")

"""Validate environment identities before the first cloud write; never print a DSN."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

VARIABLES = (
    "BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "CLOUDFLARE_WORKER_NAME",
    "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_CONFIG_REVIEWED", "CLOUDFLARE_ROUTES_JSON",
    "CLOUDFLARE_WORKERS_DEV", "DATABASE_IDENTITY", "EXPECTED_MEDIA_ROOT", "MIGRATION_APPROVED",
    "BACKUP_REFERENCE", "PRODUCTION_DATABASE_IDENTITY", "PRODUCTION_RENDER_SERVICE_ID",
    "PRODUCTION_WORKER_NAME", "PRODUCTION_BACKEND_ORIGIN", "PRODUCTION_PUBLIC_ORIGIN",
)
SECRETS = ("DATABASE_URL", "RENDER_API_KEY", "CLOUDFLARE_API_TOKEN")


class PreflightError(ValueError):
    """Only static diagnostics and setting NAMES may enter runner output."""
    def __init__(self, message, keys=(), code="configuration_invalid"):
        self.message, self.keys, self.code = message, tuple(keys), code
        super().__init__(message + (": " + ", ".join(self.keys) if self.keys else ""))


def require_settings(environment, names):
    missing = [key for key in names if not str(environment.get(key) or "").strip()]
    if missing:
        raise PreflightError("Missing GitHub deployment settings", missing, "settings_missing")


def configuration_only(environment):
    if environment.get("RELEASE_ENVIRONMENT") not in {"staging", "production"}:
        raise PreflightError("Unknown environment", ("RELEASE_ENVIRONMENT",))
    require_settings(environment, (*VARIABLES, *SECRETS))


def database_identity(value):
    from sqlalchemy.engine import make_url
    from sqlalchemy.exc import ArgumentError

    try:
        url = make_url(value)
    except (ValueError, TypeError, ArgumentError):
        raise PreflightError("Invalid PostgreSQL connection configuration", ("DATABASE_URL",)) from None
    if url.get_backend_name() not in {"postgres", "postgresql"}:
        raise PreflightError("PostgreSQL required", ("DATABASE_URL",))
    # A Supabase pooler shares host/database between projects, so include username.
    # libpq query parameters can override the URI target. Reject ambiguous DSNs
    # rather than attest one host/database and connect migrations to another.
    if set(url.query) & {"host", "hostaddr", "port", "dbname", "user", "service", "servicefile"}:
        raise PreflightError("Connection target overrides are not allowed", ("DATABASE_URL",), "database_target_ambiguous")
    parts = [(url.host or "").lower().rstrip("."), url.port or 5432, url.database, url.username]
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()


def validate(environment):
    if environment.get("RELEASE_ENVIRONMENT") not in {"staging", "production"}:
        raise PreflightError("Unknown environment", ("RELEASE_ENVIRONMENT",))
    identity_keys = ("DATABASE_URL", "DATABASE_IDENTITY", "PRODUCTION_DATABASE_IDENTITY",
                     "BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "CLOUDFLARE_WORKER_NAME",
                     "PRODUCTION_BACKEND_ORIGIN", "PRODUCTION_PUBLIC_ORIGIN", "PRODUCTION_RENDER_SERVICE_ID",
                     "PRODUCTION_WORKER_NAME")
    require_settings(environment, identity_keys)
    production = environment["RELEASE_ENVIRONMENT"] == "production"
    identity = database_identity(environment["DATABASE_URL"])
    if identity != environment["DATABASE_IDENTITY"]:
        raise PreflightError("Database identity differs from the reviewed environment", ("DATABASE_IDENTITY",))
    comparisons = [(identity, environment["PRODUCTION_DATABASE_IDENTITY"])]
    for key in ("BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "WORKER_NAME"):
        local_key = "CLOUDFLARE_WORKER_NAME" if key == "WORKER_NAME" else key
        left, right = environment[local_key], environment["PRODUCTION_" + key]
        if not left or not right:
            raise PreflightError("Missing reviewed resource identity", (local_key, "PRODUCTION_" + key))
        if key.endswith("ORIGIN"):
            for value in (left, right):
                parsed = urlsplit(value)
                if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                    raise PreflightError("HTTPS origins required", (local_key, "PRODUCTION_" + key))
            # Origins are case-insensitive and the default HTTPS port is 443.
            # Comparing input strings would allow the same production origin
            # to masquerade as staging through case or an explicit default port.
            try:
                left, right = [(urlsplit(value).hostname.lower().rstrip("."), urlsplit(value).port or 443)
                               for value in (left, right)]
            except ValueError:
                raise PreflightError("Invalid HTTPS origin port", (local_key, "PRODUCTION_" + key)) from None
        comparisons.append((left, right))
    if any((left == right) != production for left, right in comparisons):
        conflicts = ["DATABASE_IDENTITY", "BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "CLOUDFLARE_WORKER_NAME"]
        raise PreflightError("Staging resources must be separate; production must match its inventory",
                             [key for key, (left, right) in zip(conflicts, comparisons) if (left == right) != production],
                             "resource_isolation")
    if environment.get("MIGRATION_APPROVED") != "true" or not re.fullmatch(
        r"[A-Za-z0-9_.:/-]{3,200}", environment.get("BACKUP_REFERENCE", "")
    ):
        raise PreflightError("Backup/schema compatibility review required", ("MIGRATION_APPROVED", "BACKUP_REFERENCE"))


def main():
    if sys.argv[1:] == ["--configuration-only"]:
        configuration_only(os.environ)
        print("Required deployment settings are present; resource isolation and release checks still follow.")
        return
    if sys.argv[1:] == ["--database-identity"]:
        require_settings(os.environ, ("DATABASE_URL",))
        print(database_identity(os.environ["DATABASE_URL"]))
        return
    validate(os.environ)
    if os.environ["RELEASE_ENVIRONMENT"] == "production":
        try:
            staging = json.loads(Path(".runtime/staging/receipt.json").read_text())
            digest = hashlib.sha256(Path(".runtime/release/manifest.json").read_bytes()).hexdigest()
            matches = (staging["bundle_sha256"] == digest and staging["release"] == os.environ["RELEASE_SHA"]
                       and str(staging["ci_run_id"]) == os.environ["CI_RUN_ID"])
        except (OSError, ValueError, KeyError):
            raise PreflightError("Missing or invalid staging receipt; promote a successful staging run") from None
        if not matches:
            raise PreflightError("Staging verified a different artifact")
    print("Environment isolation and release preflight passed.")


def report(status, code, keys=()):
    """Exists even when configuration fails before install or deploy files exist."""
    target = os.environ.get("RELEASE_ENVIRONMENT")
    value = {"status": status, "code": code, "keys": list(keys),
             "environment": target if target in {"staging", "production"} else "unknown"}
    try:
        path = Path(".runtime/preflight.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def run():
    try:
        main()
    except PreflightError as error:
        report("failed", error.code, error.keys)
        message = "Preflight failed: " + str(error) + ". Values are not displayed."
        print(message, file=sys.stderr)
        target = os.environ.get("RELEASE_ENVIRONMENT")
        target = target if target in {"staging", "production"} else "the target environment"
        hint = (f"Configure repository Settings > Environments > {target} > Variables / Secrets. "
                "Render Environment settings are separate from GitHub Actions settings. "
                "Do not reuse production resources for staging.")
        print(hint, file=sys.stderr)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print("::error title=Deployment configuration::" + message, file=sys.stderr)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            try:
                with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as summary:
                    summary.write("## Deployment configuration\n\n" + message + "\n\n" + hint + "\n")
            except OSError:
                pass
        return 1
    except Exception:
        report("failed", "configuration_invalid")
        print("Preflight failed: invalid resource configuration or release evidence. No credentials emitted.", file=sys.stderr)
        return 1
    report("passed", "configuration_present" if sys.argv[1:] == ["--configuration-only"] else "preflight_passed")
    return 0


if __name__ == "__main__":
    sys.exit(run())

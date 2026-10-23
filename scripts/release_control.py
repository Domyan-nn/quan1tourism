"""Trusted GitHub release gates and bounded Render polling. Never logs API bodies."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("API redirect rejected")


def api(provider, path, payload=None):
    base, key = ({"github": ("https://api.github.com", "GH_TOKEN"),
                  "render": ("https://api.render.com/v1", "RENDER_API_KEY"),
                  "cloudflare": ("https://api.cloudflare.com/client/v4", "CLOUDFLARE_API_TOKEN")}[provider])
    token = os.environ[key]
    request = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None,
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                               "Accept": "application/json", "User-Agent": "quan1-release"})
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        return json.load(response)


def run_details(run_id, workflow):
    if not str(run_id).isdigit():
        raise RuntimeError("Numeric run ID required")
    repo = os.environ["GITHUB_REPOSITORY"]
    run = api("github", f"/repos/{repo}/actions/runs/{run_id}")
    if (run["status"] != "completed" or run["conclusion"] != "success"
            or run["head_repository"]["full_name"] != repo or run["path"] != workflow
            or run["head_branch"] != os.environ.get("DEFAULT_BRANCH", "main")):
        raise RuntimeError("Only successful trusted default-branch runs can be promoted")
    return run


def gate_ci(run_id):
    run = run_details(run_id, ".github/workflows/checks.yml")
    if run["event"] != "push" or not re.fullmatch(r"[0-9a-f]{40}", run["head_sha"]):
        raise RuntimeError("Release CI must be a push on the protected default branch")
    return {"sha": run["head_sha"], "ci_run_id": str(run_id)}


def gate_staging(run_id, receipt):
    run = run_details(run_id, ".github/workflows/staging.yml")
    if run["event"] != "workflow_run" or str(receipt["staging_run_id"]) != str(run_id):
        raise RuntimeError("Staging receipt provenance mismatch")
    result = gate_ci(receipt["ci_run_id"])
    if result["sha"] != receipt["release"] or receipt["environment"] != "staging":
        raise RuntimeError("Staging did not verify this commit")
    return result


def service_path():
    service = os.environ["RENDER_SERVICE_ID"]
    if not re.fullmatch(r"srv-[A-Za-z0-9]+", service):
        raise RuntimeError("Existing Render service ID required")
    return "/services/" + service


def render_preflight():
    from release_preflight import database_identity

    path = service_path()
    service = api("render", path)
    details = service["serviceDetails"]
    runtime = details.get("runtime", details.get("env"))
    if (service.get("autoDeploy") not in {"no", False} or runtime not in {"docker", "python"}
            or service.get("autoDeployTrigger") in {"commit", "checksPass"}):
        raise RuntimeError("Render must use the reviewed Git-backed Docker/Python service with Auto-Deploy disabled")
    specific = details.get("envSpecificDetails", {})
    if (service.get("preDeployCommand") or details.get("preDeployCommand") or specific.get("preDeployCommand")
            or specific.get("dockerCommand") or details.get("dockerCommand")):
        raise RuntimeError("Clear custom startup/pre-deploy commands; migration belongs to this release job")
    if runtime == "python" and (service.get("rootDir") != "services/backend"
            or specific.get("buildCommand") != "uv sync --frozen --no-dev"
            or specific.get("startCommand") != "uv run --frozen --no-dev uvicorn app.main:app --host 0.0.0.0 --port $PORT"):
        raise RuntimeError("Native Python build/start commands must match the locked, migration-free runbook")
    # Inspect secrets only in memory: never persist/log environment API responses.
    variables = api("render", path + "/env-vars?limit=100")
    values = {item["envVar"]["key"]: item["envVar"]["value"] for item in variables}
    if database_identity(values.get("DATABASE_URL", "")) != os.environ["DATABASE_IDENTITY"]:
        raise RuntimeError("Render database differs from the approved migration target")
    expected = {"APP_ENV": "production", "COOKIE_SECURE": "true", "AI_MODE": "worker",
                "QUAN1_IGNORE_LOCAL_ENV": "1", "MEDIA_ROOT": os.environ["EXPECTED_MEDIA_ROOT"]}
    if any(values.get(key) != value for key, value in expected.items()) or values.get("RELEASE_SHA"):
        raise RuntimeError("Render runtime/media settings differ from the reviewed environment")
    del values, variables
    deploys = api("render", path + "/deploys?limit=20")
    active = {"created", "queued", "build_in_progress", "pre_deploy_in_progress", "update_in_progress"}
    if any(item["deploy"]["status"] in active for item in deploys):
        raise RuntimeError("A Render deployment is already active")
    previous = next((item["deploy"] for item in deploys if item["deploy"]["status"] == "live"), None)
    if not previous:
        raise RuntimeError("Record an existing live release before migration")
    write(".runtime/render-before.json", {"deploy_id": previous["id"], "release": previous["commit"]["id"], "runtime": runtime})


def render_deploy(release, *, timeout=1800, interval=10):
    path = service_path()
    deploy = api("render", path + "/deploys", {"commitId": release, "clearCache": "do_not_clear"})
    deploy_id = quote(deploy["id"], safe="")
    # Persist the ID immediately so an interrupted runner can be reconciled without triggering twice.
    write(".runtime/render-deploy.json", {"deploy_id": deploy["id"], "release": release, "status": "requested"})
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = api("render", path + "/deploys/" + deploy_id)
        if current["status"] == "live":
            if current.get("commit", {}).get("id") != release:
                raise RuntimeError("Live Render commit differs from approved release")
            write(".runtime/render-deploy.json", {"deploy_id": deploy["id"], "release": release, "status": "live"})
            print("Render reports the expected commit live; public smoke is still required.")
            return
        if current["status"] in {"build_failed", "pre_deploy_failed", "update_failed", "canceled", "deactivated"}:
            raise RuntimeError("Render deployment failed")
        time.sleep(interval)
    raise RuntimeError("Render polling timed out; reconcile recorded deploy ID before any retry")


def cloudflare_state(output):
    account, name = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_WORKER_NAME"]
    if not re.fullmatch(r"[a-f0-9]{32}", account) or not re.fullmatch(r"[a-z0-9-]+", name):
        raise RuntimeError("Existing Cloudflare account and Worker required")
    response = api("cloudflare", f"/accounts/{account}/workers/scripts/{name}/deployments")
    deployments = response["result"]["deployments"]
    if not response["success"] or not deployments:
        raise RuntimeError("Cannot identify an existing Worker deployment")
    current = deployments[0]
    write(output, {"deployment_id": current["id"], "versions": current["versions"]})


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def receipt(environment):
    def read(name):
        return json.loads(Path(".runtime/" + name + ".json").read_text(encoding="utf-8"))
    manifest = read("release/manifest")
    value = {"environment": environment, "release": os.environ["RELEASE_SHA"],
             "ci_run_id": os.environ["CI_RUN_ID"], "staging_run_id": os.environ.get("STAGING_RUN_ID", os.environ["GITHUB_RUN_ID"]),
             "timestamp": datetime.now(timezone.utc).isoformat(), "worker_protocol": manifest["worker_protocol"],
             "bundle_sha256": hashlib.sha256(Path(".runtime/release/manifest.json").read_bytes()).hexdigest(),
             "backend_before": read("render-before"), "backend_after": read("render-deploy"),
             "migration": read("migration"), "worker_before": read("worker-before"), "worker_after": read("worker-after")}
    if value["release"] != manifest["release"] or value["backend_after"]["status"] != "live":
        raise RuntimeError("Release evidence mismatch")
    if environment == "production":
        staging = json.loads(Path(".runtime/staging/receipt.json").read_text())
        if staging["bundle_sha256"] != value["bundle_sha256"]:
            raise RuntimeError("Production bundle differs from staging")
    write(".runtime/receipt.json", value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["gate-ci", "gate-staging", "render-preflight", "render-deploy", "worker-state", "receipt"])
    parser.add_argument("--run-id")
    parser.add_argument("--output")
    parser.add_argument("--environment", choices=["staging", "production"])
    args = parser.parse_args()
    if args.action.startswith("gate-"):
        result = (gate_ci(args.run_id) if args.action == "gate-ci" else gate_staging(args.run_id,
                  json.loads(Path(".runtime/staging/receipt.json").read_text())))
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in result.items():
                output.write(f"{key}={value}\n")
    elif args.action == "render-preflight":
        render_preflight()
    elif args.action == "render-deploy":
        render_deploy(os.environ["RELEASE_SHA"])
    elif args.action == "worker-state":
        cloudflare_state(args.output)
    else:
        receipt(args.environment)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit("Release control failed. Check provenance, dashboard settings, or recorded deployment IDs; API bodies suppressed.")

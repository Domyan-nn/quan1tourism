import importlib.util
import json
import sys
from pathlib import Path

import pytest


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[3] / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


control = load("release_control")
preflight = load("release_preflight")


@pytest.fixture()
def trusted(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.setenv("DEFAULT_BRANCH", "main")
    return {"status": "completed", "conclusion": "success", "head_repository": {"full_name": "owner/repo"},
            "path": ".github/workflows/checks.yml", "head_branch": "main", "head_sha": "a" * 40, "event": "push"}


@pytest.mark.parametrize("field,value", [("conclusion", "failure"), ("conclusion", "cancelled"),
                         ("head_branch", "feature"), ("event", "pull_request"),
                         ("path", ".github/workflows/fake.yml"), ("head_repository", {"full_name": "fork/repo"})])
def test_failed_pr_fork_or_wrong_workflow_cannot_release(monkeypatch, trusted, field, value):
    monkeypatch.setattr(control, "api", lambda *args: trusted | {field: value})
    with pytest.raises(RuntimeError):
        control.gate_ci("123")


def test_production_requires_successful_staging_of_the_same_ci(monkeypatch, trusted):
    staging = trusted | {"path": ".github/workflows/staging.yml", "event": "workflow_run"}
    monkeypatch.setattr(control, "api", lambda _, path: staging if path.endswith("/456") else trusted)
    receipt = {"staging_run_id": "456", "ci_run_id": "123", "release": "a" * 40, "environment": "staging"}
    assert control.gate_staging("456", receipt)["sha"] == "a" * 40
    with pytest.raises(RuntimeError):
        control.gate_staging("456", receipt | {"release": "b" * 40})


@pytest.mark.parametrize("terminal", ["live", "build_failed", "pre_deploy_failed", "update_failed", "canceled", "deactivated", "wrong_commit"])
def test_render_waits_for_live_and_checks_commit(monkeypatch, tmp_path, terminal):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("RENDER_SERVICE_ID", "srv-test")
    calls = []
    responses = iter([{"id": "dep-test"}, {"status": "build_in_progress"},
                      {"status": "live" if terminal == "wrong_commit" else terminal,
                       "commit": {"id": "b" * 40 if terminal == "wrong_commit" else "a" * 40}}])
    def api(*args):
        calls.append(args)
        return next(responses)
    monkeypatch.setattr(control, "api", api)
    monkeypatch.setattr(control.time, "sleep", lambda _: None)
    if terminal == "live":
        control.render_deploy("a" * 40)
        assert json.loads(Path(".runtime/render-deploy.json").read_text())["status"] == "live"
    else:
        with pytest.raises(RuntimeError):
            control.render_deploy("a" * 40)
    assert calls[0][2]["commitId"] == "a" * 40
    assert len(calls) == 3  # Trigger HTTP success alone was insufficient.


def test_staging_cannot_accidentally_use_production_resources():
    env = {"RELEASE_ENVIRONMENT": "staging", "DATABASE_URL": "postgresql://ci@stage/db?sslmode=require",
           "MIGRATION_APPROVED": "true", "BACKUP_REFERENCE": "inventory-stage-1"}
    env["DATABASE_IDENTITY"] = preflight.database_identity(env["DATABASE_URL"])
    env["PRODUCTION_DATABASE_IDENTITY"] = preflight.database_identity("postgresql://ci@prod/db")
    for key in ("BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "WORKER_NAME"):
        env["CLOUDFLARE_WORKER_NAME" if key == "WORKER_NAME" else key] = "https://stage.test" if key.endswith("ORIGIN") else "stage"
        env["PRODUCTION_" + key] = "https://prod.test" if key.endswith("ORIGIN") else "prod"
    preflight.validate(env)
    for key in ("DATABASE_IDENTITY", "BACKEND_ORIGIN", "PUBLIC_ORIGIN", "RENDER_SERVICE_ID", "WORKER_NAME"):
        bad = env.copy()
        if key == "DATABASE_IDENTITY":
            bad["PRODUCTION_DATABASE_IDENTITY"] = bad["DATABASE_IDENTITY"]
        else:
            bad["CLOUDFLARE_WORKER_NAME" if key == "WORKER_NAME" else key] = bad["PRODUCTION_" + key]
        with pytest.raises(ValueError):
            preflight.validate(bad)


@pytest.mark.parametrize("runtime,disabled", [("docker", "no"), ("docker", False), ("python", "no")])
def test_render_preflight_preserves_existing_runtime_and_requires_one_migration_owner(monkeypatch, tmp_path, runtime, disabled):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("RENDER_SERVICE_ID", "srv-test")
    monkeypatch.setenv("DATABASE_IDENTITY", preflight.database_identity("postgresql://ci@stage/db"))
    monkeypatch.setenv("EXPECTED_MEDIA_ROOT", "/var/data/media")
    specific = {} if runtime == "docker" else {
        "buildCommand": "uv sync --frozen --no-dev",
        "startCommand": "uv run --frozen --no-dev uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    }
    details = {"env": runtime, "envSpecificDetails": specific, "preDeployCommand": ""}
    service = {"autoDeploy": disabled, "rootDir": "services/backend", "serviceDetails": details}
    deploys = [{"deploy": {"id": "dep-before", "status": "live", "commit": {"id": "b" * 40}}}]
    values = {"DATABASE_URL": "postgresql://ci@stage/db", "APP_ENV": "production", "COOKIE_SECURE": "true",
              "AI_MODE": "worker", "QUAN1_IGNORE_LOCAL_ENV": "1", "MEDIA_ROOT": "/var/data/media"}
    def api(_, path):
        if "env-vars" in path:
            return [{"envVar": {"key": key, "value": value}} for key, value in values.items()]
        return deploys if "deploys" in path else service
    monkeypatch.setattr(control, "api", api)
    control.render_preflight()
    assert json.loads(Path(".runtime/render-before.json").read_text())["runtime"] == runtime
    details["preDeployCommand"] = "alembic upgrade head"
    with pytest.raises(RuntimeError):
        control.render_preflight()
    details["preDeployCommand"] = ""
    service["autoDeploy"] = "yes"
    with pytest.raises(RuntimeError):
        control.render_preflight()
    service["autoDeploy"] = disabled
    values["DATABASE_URL"] = "postgresql://ci@production/db"
    with pytest.raises(RuntimeError, match="database differs"):
        control.render_preflight()


def test_render_poll_timeout_keeps_deploy_id_for_reconciliation(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("RENDER_SERVICE_ID", "srv-test")
    moments = iter([0, 0, 2])
    monkeypatch.setattr(control.time, "monotonic", lambda: next(moments))
    monkeypatch.setattr(control.time, "sleep", lambda _: None)
    monkeypatch.setattr(control, "api", lambda *args: {"id": "dep-active", "status": "build_in_progress"})
    with pytest.raises(RuntimeError, match="reconcile"):
        control.render_deploy("a" * 40, timeout=1)
    assert json.loads(Path(".runtime/render-deploy.json").read_text())["deploy_id"] == "dep-active"

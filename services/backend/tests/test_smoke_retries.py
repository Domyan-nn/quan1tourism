from collections import Counter
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
from urllib.error import URLError

import pytest


spec = importlib.util.spec_from_file_location("release_smoke", Path(__file__).parents[3] / "scripts/smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
RELEASE = "a" * 40


class Reply(io.BytesIO):
    def __init__(self, path, data, status=200):
        super().__init__(data if isinstance(data, bytes) else json.dumps(data).encode())
        self.status, self.url = status, "https://stage.test" + path
        self.headers = Message()
        self.headers["Cache-Control"] = "no-store"
        self.headers["Set-Cookie"] = "visit=test; HttpOnly; Secure"
        if path == "/release.json":
            self.headers["X-Release-SHA"] = RELEASE


def opener(monkeypatch, changes=None):
    counts = Counter()
    responses = {
        "/": b'<div id="root"></div>', "/admin/": b'<div id="root"></div>',
        "/release.json": {"release": RELEASE},
        "/api/v1/health/live": {"status": "ok"}, "/api/v1/health/ready": {"status": "ok"},
        "/api/v1/version": {"release": RELEASE}, "/api/v1/pois": {"items": [{"id": "fixture"}]},
        "/api/v1/pois/fixture?track_view=false": {"id": "fixture"},
        "/api/v1/admin/pois": {}, "/api/v1/does-not-exist": {},
    }

    class Opener:
        def open(self, request, timeout):
            path = request.full_url.removeprefix("https://stage.test")
            counts[path] += 1
            assert request.get_method() == "GET"
            result = changes(path, counts[path]) if changes else None
            if isinstance(result, Exception):
                raise result
            if result is not None:
                return result
            status = 401 if path.endswith("admin/pois") else 404 if path.endswith("does-not-exist") else 200
            return Reply(path, responses[path], status)

    monkeypatch.setattr(smoke, "build_opener", lambda *args: Opener())
    return counts


def test_smoke_retries_transport_readiness_and_stale_release_then_checks_exact_sha(monkeypatch):
    def changes(path, count):
        if count == 1:
            if path.endswith("health/live"):
                return URLError("transport details must stay private")
            if path.endswith("health/ready"):
                return Reply(path, {}, 503)
            if path.endswith("version"):
                return Reply(path, {"release": "b" * 40})
    counts = opener(monkeypatch, changes)
    smoke.smoke("https://stage.test", RELEASE, tiles=False, site=False, retry_delay=0)
    assert counts["/api/v1/version"] == counts["/api/v1/health/ready"] == counts["/api/v1/health/live"] == 2
    assert counts["/api/v1/pois/fixture?track_view=false"] == 1


def test_smoke_never_accepts_another_release_after_retry_budget(monkeypatch):
    counts = opener(monkeypatch, lambda path, count: Reply(path, {"release": "b" * 40})
                    if path.endswith("version") else None)
    with pytest.raises(AssertionError, match="another release"):
        smoke.smoke("https://stage.test", RELEASE, tiles=False, site=False, attempts=3, retry_delay=0)
    assert counts["/api/v1/version"] == 3
    assert counts["/api/v1/pois"] == 0


@pytest.mark.parametrize("failure", [URLError("private transport error"), 503])
def test_smoke_transport_and_server_failure_budget_is_bounded(monkeypatch, failure):
    counts = opener(monkeypatch, lambda path, count: failure if isinstance(failure, Exception)
                    else Reply(path, {}, failure))
    with pytest.raises((AssertionError, RuntimeError)):
        smoke.smoke("https://stage.test", RELEASE, tiles=False, site=False, attempts=3, retry_delay=0)
    assert counts["/api/v1/health/live"] == 3


def test_smoke_does_not_retry_permanent_routing_or_auth_failures(monkeypatch):
    counts = opener(monkeypatch, lambda path, count: Reply(path, {}, 403))
    with pytest.raises(AssertionError):
        smoke.smoke("https://stage.test", RELEASE, tiles=False, site=False, attempts=3, retry_delay=0)
    assert counts["/api/v1/health/live"] == 1


@pytest.mark.parametrize("propagates", [True, False])
def test_smoke_requires_worker_header_sha_even_when_frontend_body_matches(monkeypatch, propagates):
    def changes(path, count):
        if path == "/release.json" and (not propagates or count < 3):
            response = Reply(path, {"release": RELEASE})
            response.headers.replace_header("X-Release-SHA", "b" * 40)
            return response
    counts = opener(monkeypatch, changes)
    if propagates:
        smoke.smoke("https://stage.test", RELEASE, tiles=False, require_worker=True, attempts=3, retry_delay=0)
    else:
        with pytest.raises(AssertionError, match="another release"):
            smoke.smoke("https://stage.test", RELEASE, tiles=False, require_worker=True, attempts=3, retry_delay=0)
    assert counts["/release.json"] == 3

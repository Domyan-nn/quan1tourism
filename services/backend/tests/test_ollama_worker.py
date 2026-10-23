"""PC client protocol without Ollama, Internet or real credentials."""
import importlib.util
import io
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

spec = importlib.util.spec_from_file_location("ollama_worker", Path(__file__).parents[3] / "scripts/ollama_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def test_client_authentication_timeout_redirect_policy_and_payload(monkeypatch):
    class Opener:
        def open(self, request, timeout):
            assert timeout == 30
            assert request.get_header("Authorization") == "Bearer synthetic-test-token"
            assert request.get_header("X-requested-with") == "Quan1Admin"
            assert request.full_url == "https://backend.test/api/v1/worker/claim"
            assert json.loads(request.data) == {}
            return io.BytesIO(b'{"job":null}')

    def opener(handler):
        assert isinstance(handler, worker.NoRedirects)
        return Opener()

    monkeypatch.setattr(worker, "build_opener", opener)
    assert worker.call_server("https://backend.test", "synthetic-test-token", "/claim", {}) == {"job": None}
    for url in ("http://public.test", "https://user:pass@backend.test", "https://backend.test/path"):
        with pytest.raises(ValueError):
            worker.server_url(url)


@pytest.mark.parametrize("failure", [TimeoutError, lambda: HTTPError("https://backend.test", 503, "unavailable", {}, None)])
def test_lost_completion_retries_same_lease_and_does_not_log_credentials(monkeypatch, capsys, failure):
    calls = []
    class Thread:
        def __init__(self, **kwargs):
            pass
        def start(self):
            pass
        def join(self, **kwargs):
            pass

    class Event:
        def set(self):
            pass
        def wait(self, seconds):
            pass

    monkeypatch.setattr(worker.threading, "Thread", Thread)
    monkeypatch.setattr(worker.threading, "Event", Event)
    monkeypatch.setattr(worker, "ollama_status", lambda: {"ready": True})
    monkeypatch.setattr(worker, "process_job", lambda job: {"lease": job["lease"], "draft": {"name": "Test"}})

    def call(origin, token, path, payload):
        calls.append((path, payload))
        if path == "/claim":
            return {"job": {"id": "job", "lease": "same-lease"}}
        if len(calls) < 4:
            raise failure()
        return {}

    monkeypatch.setattr(worker, "call_server", call)
    worker.run("https://backend.test", "never-log-this-synthetic-token", once=True)
    assert len(calls) == 4
    assert all(payload["lease"] == "same-lease" for _, payload in calls[1:])
    assert "never-log" not in capsys.readouterr().out


def test_generation_timeout_returns_sanitized_error_with_lease(monkeypatch):
    def fail(*args, **kwargs):
        raise TimeoutError("sensitive model/input")
    monkeypatch.setattr(worker, "generate_draft", fail)
    assert worker.process_job({"lease": "lease", "payload": {"article": {"url": "https://vi.wikipedia.org/wiki/Test"},
                              "categories": [], "languages": []}}) == {"lease": "lease", "error": "generation_failed"}

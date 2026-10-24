from datetime import timedelta

from sqlalchemy import select

from app.models import AiJob, Poi, now
from conftest import login
from test_wikipedia import URL, upstream  # noqa: F401 -- shared upstream fixture
from test_workflow import action, create, draft_payload

TOKEN = "worker-test-secret-32-characters-long"
WORKER = {"Authorization": "Bearer " + TOKEN}


def enqueue(client):
    response = client.post("/api/v1/admin/ai/jobs", json={"url": URL})
    assert response.status_code == 202, response.text
    return response.json()["id"]


def test_worker_queue_roundtrip_is_private_durable_and_never_publishes(env, upstream, monkeypatch):  # noqa: F811
    from app.wikipedia import generate_draft

    client, factory, _ = env
    monkeypatch.setenv("AI_MODE", "worker")
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    login(client, "admin")
    assert not client.get("/api/v1/admin/ai/status").json()["ready"]
    assert client.post("/api/v1/worker/claim", json={}).status_code == 401
    assert client.post("/api/v1/worker/heartbeat", headers=WORKER,
                       json={"model": "qwen3:4b", "ready": True}).status_code == 200
    assert client.get("/api/v1/admin/ai/status").json()["ready"]
    job_id = enqueue(client)
    # No model inference happens on Render.
    assert not any(url.endswith("/api/chat") for url, _ in upstream["calls"])
    claimed = client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"]
    assert claimed["id"] == job_id
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"] is None
    assert client.get(f"/api/v1/admin/ai/jobs/{job_id}").json()["status"] == "running"
    payload = claimed["payload"]
    assert payload["categories"][0]["id"] == "test-category"
    assert payload["categories"][0]["name"] == "Test"
    draft = generate_draft(URL, payload["categories"], payload["languages"], article=payload["article"])
    completion = {"lease": claimed["lease"], **draft}
    endpoint = f"/api/v1/worker/jobs/{job_id}/complete"
    assert client.post(endpoint, headers=WORKER, json=completion | {"lease": "wrong" * 10}).status_code == 409
    bad = {**completion, "draft": {**draft["draft"], "name": "Changed by worker"}}
    assert client.post(endpoint, headers=WORKER, json=bad).status_code == 422
    assert client.post(endpoint, headers=WORKER, json=completion).status_code == 200
    assert client.post(endpoint, headers=WORKER, json=completion).status_code == 200  # idempotent
    result = client.get(f"/api/v1/admin/ai/jobs/{job_id}").json()
    assert result["status"] == "completed" and result["result"]["draft"]["source"]
    assert "payload" not in result and "lease_hash" not in result
    with factory() as db:
        assert not list(db.scalars(select(Poi)))
    login(client, "reviewer")
    assert client.get(f"/api/v1/admin/ai/jobs/{job_id}").status_code == 404
    login(client, "admin")
    created = client.post("/api/v1/admin/pois", json=result["result"]["draft"])
    assert created.status_code == 201
    poi = action(client, created.json(), "submit").json()
    assert action(client, poi, "approve", confirmed_review=False).status_code == 422
    poi = action(client, poi, "approve").json()
    assert action(client, poi, "publish").status_code == 200


def test_expired_worker_lease_is_reclaimed_and_old_results_rejected(env, upstream, monkeypatch):  # noqa: F811
    client, factory, _ = env
    monkeypatch.setenv("AI_MODE", "worker")
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    login(client, "admin")
    job_id = enqueue(client)
    first = client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"]
    with factory() as db:
        db.get(AiJob, job_id).lease_until = now() - timedelta(seconds=1)
        db.commit()
    second = client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"]
    assert second["id"] == first["id"] and second["lease"] != first["lease"]
    endpoint = f"/api/v1/worker/jobs/{job_id}/complete"
    assert client.post(endpoint, headers=WORKER, json={"lease": first["lease"], "error": "x"}).status_code == 409
    assert client.post(endpoint, headers=WORKER, json={"lease": second["lease"], "error": "secret"}).status_code == 200
    result = client.get(f"/api/v1/admin/ai/jobs/{job_id}").json()
    assert result["status"] == "failed" and "secret" not in result["error"]


def test_retry_budget_and_queue_timeout_do_not_affect_public_readiness(env, upstream, monkeypatch):  # noqa: F811
    client, factory, _ = env
    monkeypatch.setenv("AI_MODE", "worker")
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    login(client, "admin")
    job_id = enqueue(client)
    for _ in range(3):
        assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"]["id"] == job_id
        with factory() as db:
            db.get(AiJob, job_id).lease_until = now() - timedelta(seconds=1)
            db.commit()
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"] is None
    assert client.get(f"/api/v1/admin/ai/jobs/{job_id}").json()["status"] == "failed"
    expired = enqueue(client)
    with factory() as db:
        db.get(AiJob, expired).created_at = now() - timedelta(hours=25)
        db.commit()
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"] is None
    assert client.get(f"/api/v1/admin/ai/jobs/{expired}").json()["status"] == "failed"
    assert client.get("/api/v1/health/ready").status_code == 200


def test_duplicate_name_is_checked_on_create_update_and_before_ai(env, upstream, monkeypatch):  # noqa: F811
    client, _, _ = env
    login(client, "admin")
    poi = create(client, "Nhà Văn hóa Thanh niên")
    payload = draft_payload() | {"name": "  nha van HOA thanh-nien "}
    assert client.post("/api/v1/admin/pois", json=payload).status_code == 409
    matches = client.post("/api/v1/admin/pois/check-duplicates", json=payload).json()["items"]
    assert matches[0]["id"] == poi["id"]
    another = create(client, "Another place")
    assert client.put(f"/api/v1/admin/pois/{another['id']}", json=payload).status_code == 409
    response = client.post("/api/v1/admin/ai/wikipedia", json={"url": URL})
    assert response.json()["existing_poi"]["id"] == poi["id"]
    assert not any(url.endswith("/api/chat") for url, _ in upstream["calls"])
    monkeypatch.setenv("AI_MODE", "worker")
    assert client.post("/api/v1/admin/ai/jobs", json={"url": URL}).status_code == 409


def test_only_admin_can_confirm_review_and_publish(env):
    client, _, _ = env
    login(client, "admin")
    poi = action(client, create(client), "submit").json()
    login(client, "reviewer")
    assert action(client, poi, "approve").status_code == 403
    assert action(client, poi, "publish").status_code == 403
    login(client, "admin")
    assert action(client, poi, "approve", confirmed_review=False).status_code == 422
    poi = action(client, poi, "approve").json()
    payload = draft_payload() | {"revision": poi["revision"], "address": "Changed after approval"}
    poi = client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload).json()
    assert poi["status"] == "draft"
    assert action(client, poi, "publish").status_code == 409


def test_same_wikidata_place_in_another_language_is_blocked_before_model(env, upstream):  # noqa: F811
    client, _, _ = env
    login(client, "admin")
    draft = client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).json()["draft"]
    assert client.post("/api/v1/admin/pois", json=draft).status_code == 201
    # Different name and article URL still represent the same Wikidata entity.
    translated = {**draft, "name": "Youth Cultural House", "source": {
        **draft["source"], "url": "https://en.wikipedia.org/wiki/Youth_Cultural_House",
    }}
    assert client.post("/api/v1/admin/pois", json=translated).status_code == 409
    upstream["calls"].clear()
    response = client.post("/api/v1/admin/ai/wikipedia", json={"url": translated["source"]["url"]})
    assert response.json()["existing_poi"]
    assert not any(url.endswith("/api/chat") for url, _ in upstream["calls"])


def test_database_identity_reservation_cannot_be_bypassed_by_another_writer(env):
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.duplicates import reserve_identities

    client, factory, _ = env
    login(client, "admin")
    create(client)
    with factory() as db:
        other = Poi(name="DIA DIEM THU NGHIEM", category_id="test-category", translations={})
        db.add(other)
        db.flush()
        with pytest.raises(IntegrityError):
            reserve_identities(db, other)
        db.rollback()
    assert client.get("/api/v1/admin/pois").json()["total"] == 1


def test_admin_pairs_hashed_worker_key_and_rotation_revokes_previous_key(env, monkeypatch):
    from app.models import AiWorker

    client, factory, _ = env
    monkeypatch.delenv("AI_WORKER_TOKEN", raising=False)
    assert client.post("/api/v1/admin/ai/worker-key", json={"token": TOKEN}).status_code == 401
    login(client, "editor")
    assert client.post("/api/v1/admin/ai/worker-key", json={"token": TOKEN}).status_code == 403
    login(client, "admin")
    assert client.post("/api/v1/admin/ai/worker-key", json={"token": TOKEN}).status_code == 200
    with factory() as db:
        stored = db.get(AiWorker, "local").token_hash
        assert len(stored) == 64 and stored != TOKEN
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).status_code == 200
    replacement = "new-secret-32-characters-for-test-worker"
    assert client.post("/api/v1/admin/ai/worker-key", json={"token": replacement}).status_code == 200
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).status_code == 401
    assert client.post("/api/v1/worker/claim", headers={"Authorization": "Bearer " + replacement}, json={}).status_code == 200

from app.models import AiJob, Poi
from conftest import login
from test_location_narration import ENGLISH, complete, queue, setup_poi
from test_workflow import action, draft_payload


def state(poi, code):
    return poi["narration_review"][code]


def test_manual_draft_is_not_approval_and_publication_binds_hash_and_revision(env):
    client, factory, _ = env
    login(client, "admin")
    payload = draft_payload()
    poi = client.post("/api/v1/admin/pois", json=payload).json()
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    assert state(poi, "vi")["state"] == "pending"
    assert state(poi, "vi")["source"] == "manual"
    assert state(poi, "fr")["state"] == "empty"
    submitted = action(client, poi, "submit").json()
    assert state(submitted, "vi")["state"] == "pending"
    approved = action(client, submitted, "approve").json()
    assert state(approved, "vi")["state"] == "approved"
    assert client.get(endpoint).json()["narration_review"] == approved["narration_review"]
    # A later place revision alone cannot invalidate unchanged approved text.
    same = client.put(endpoint, json=payload | {"revision": approved["revision"], "status": "draft"}).json()
    assert state(same, "en")["state"] == "approved"
    edited_payload = payload | {"revision": same["revision"], "status": "draft",
        "translations": {"en": {"title": "English", "text": "Edited narration."}}}
    edited = client.put(endpoint, json=edited_payload).json()
    assert state(edited, "en")["state"] == "pending"
    assert state(edited, "vi")["state"] == "approved"
    # Injecting an approval for a different hash must never approve this version.
    with factory() as db:
        row = db.get(Poi, poi["id"])
        row.narration_meta = {**row.narration_meta, "en": approved["narration_meta"]["en"]}
        db.commit()
    assert state(client.get(endpoint).json(), "en")["state"] == "pending"


def test_legacy_content_and_ai_reviewed_origin_are_not_approval_evidence(env):
    client, factory, _ = env
    poi, _ = setup_poi(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    old_public = client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json()
    with factory() as db:
        row = db.get(Poi, poi["id"])
        row.narration_meta = {"vi": {"origin": "ai_reviewed", "reviewed_at": "2026-01-01"}}
        db.commit()
    assert state(client.get(endpoint).json(), "vi")["state"] == "pending"
    assert client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json() == old_public
    assert "narration_review" not in old_public


def test_valid_job_is_pending_before_apply_and_discard_restores_approved(env, monkeypatch):
    from test_ai_jobs import TOKEN

    client, factory, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, payload = setup_poi(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    poi = client.put(endpoint, json=payload | {"revision": poi["revision"],
        "translations": {**payload["translations"], "en": {"title": "English narration", "text": ENGLISH}}}).json()
    assert state(poi, "en")["state"] == "approved"
    public = client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json()
    queued = queue(client, poi, replace_existing=True).json()["items"][0]
    assert state(client.get(endpoint).json(), "en")["state"] == "approved"  # No result yet.
    complete(client)
    pending = client.get(endpoint).json()
    assert state(pending, "en")["state"] == "pending"
    assert state(pending, "en")["source"] == "ai"
    assert state(pending, "en")["preserves_approved"]
    assert state(pending, "en")["pending_job_id"] == queued["id"]
    jobs = client.get(endpoint + "/narration-jobs").json()
    assert jobs["poi_revision"] == pending["revision"]
    assert jobs["narration_review"] == pending["narration_review"]
    discard = endpoint + f"/narration-jobs/{queued['id']}/discard"
    assert client.post(discard, json={"revision": poi["revision"] - 1}).status_code == 409
    login(client, "editor")
    assert client.post(discard, json={"revision": poi["revision"]}).status_code == 403
    login(client, "admin")
    discarded = client.post(discard, json={"revision": poi["revision"]}).json()
    assert state(discarded, "en")["state"] == "approved"
    assert state(discarded, "en")["pending_job_id"] is None
    assert client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json() == public
    assert client.post(endpoint + f"/narration-jobs/{queued['id']}/apply", json={
        "revision": discarded["revision"], "confirmed_review": True,
        "translation": {"title": "English narration", "text": ENGLISH}}).status_code == 409
    with factory() as db:
        assert db.get(AiJob, queued["id"]).result["discarded_at"]


def test_rejected_stale_and_wrong_target_jobs_never_create_pending_content(env, monkeypatch):
    from test_ai_jobs import TOKEN

    client, factory, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, payload = setup_poi(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    queued = queue(client, poi).json()["items"][0]
    complete(client, "Short stub")
    assert state(client.get(endpoint).json(), "en")["state"] == "empty"
    # Even a forged stored validation result is rechecked by the API.
    with factory() as db:
        row = db.get(AiJob, queued["id"])
        row.status = "completed"
        row.result = {"translation": {"title": "Wrong language", "text": payload["translations"]["vi"]["text"]},
                      "validation": {"status": "passed"}, "model": "test"}
        db.commit()
    assert state(client.get(endpoint).json(), "en")["state"] == "empty"
    # A valid result becomes ineligible when its target hash no longer matches.
    with factory() as db:
        row = db.get(AiJob, queued["id"])
        row.result = {"translation": {"title": "English narration", "text": ENGLISH}, "model": "test"}
        row.payload = {**row.payload, "target_hash": "wrong-target"}
        db.commit()
    assert state(client.get(endpoint).json(), "en")["state"] == "empty"


def test_ai_applied_to_saved_draft_still_needs_content_approval(env, monkeypatch):
    from test_ai_jobs import TOKEN

    client, _, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, _ = setup_poi(client)
    queue(client, poi)
    job = complete(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    applied = client.post(endpoint + f"/narration-jobs/{job['id']}/apply", json={
        "revision": poi["revision"], "confirmed_review": True,
        "translation": {"title": "English narration", "text": ENGLISH}}).json()
    assert state(applied, "en")["state"] == "pending"
    assert state(applied, "en")["source"] == "ai"
    assert state(applied, "en")["pending_job_id"] is None
    login(client, "reviewer")
    assert action(client, applied, "approve").status_code == 403


def test_publishing_does_not_approve_hidden_language_content(env):
    client, _, _ = env
    login(client, "admin")
    french = next(item for item in client.get("/api/v1/admin/languages").json() if item["code"] == "fr")
    client.put("/api/v1/admin/languages/fr", json=french | {"enabled": False})
    payload = draft_payload()
    payload["translations"]["fr"] = {"title": "Un brouillon", "text": "Contenu non vérifié."}
    poi = client.post("/api/v1/admin/pois", json=payload | {"status": "published"}).json()
    assert state(poi, "en")["state"] == "approved"
    assert state(poi, "fr")["state"] == "pending"
    assert "approval" not in poi["narration_meta"]["fr"]
    assert not poi["translations"]["fr"]["published"]
    public_endpoint = f"/api/v1/pois/{poi['id']}?track_view=false"
    assert "fr" not in client.get(public_endpoint).json()["translations"]
    assert "fr" not in client.get("/api/v1/pois").json()["items"][0]["translations"]
    client.put("/api/v1/admin/languages/fr", json=french)
    assert state(client.get(f"/api/v1/admin/pois/{poi['id']}").json(), "fr")["state"] == "pending"
    # Enabling a language must not implicitly publish its unreviewed draft.
    assert "fr" not in client.get(public_endpoint).json()["translations"]
    republished = client.put(f"/api/v1/admin/pois/{poi['id']}",
        json=payload | {"revision": poi["revision"], "status": "published"})
    assert republished.status_code == 200
    assert client.get(public_endpoint).json()["translations"]["fr"]["text"] == "Contenu non vérifié."


def test_model_name_in_source_does_not_forge_ai_provenance(env):
    client, _, _ = env
    login(client, "admin")
    payload = draft_payload() | {"source": {"url": "https://vi.wikipedia.org/wiki/Test",
        "title": "Test", "retrieved_at": "2026-10-01T00:00:00Z", "model": "client-claimed-model"}}
    poi = client.post("/api/v1/admin/pois", json=payload).json()
    assert state(poi, "en")["source"] == "manual"
    assert state(poi, "en")["state"] == "pending"


def test_accessible_old_job_remains_pending_after_many_newer_failures(env, monkeypatch):
    from datetime import timedelta
    from app.models import now
    from test_ai_jobs import TOKEN

    client, factory, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, _ = setup_poi(client)
    job = queue(client, poi).json()["items"][0]
    complete(client)
    with factory() as db:
        original = db.get(AiJob, job["id"])
        for _ in range(501):
            db.add(AiJob(requested_by=original.requested_by, payload={**original.payload, "locale": "de"},
                         status="failed", error="model_timeout", created_at=now() + timedelta(seconds=1)))
        db.commit()
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    current = client.get(endpoint).json()
    assert state(current, "en")["pending_job_id"] == job["id"]
    assert any(item["id"] == job["id"] for item in client.get(endpoint + "/narration-jobs").json()["items"])

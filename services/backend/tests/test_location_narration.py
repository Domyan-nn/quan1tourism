from sqlalchemy import func, select

from app.models import AiJob, Category, Poi
from conftest import login
from test_ai_jobs import TOKEN, WORKER
from test_workflow import draft_payload

SOURCE = "Đây là nội dung nguồn đã được quản trị viên xác minh cho địa điểm ở Quận 1. " * 5
ENGLISH = ("Visitors can explore the place described in the verified source. Take time to observe its surroundings "
           "and the details of the building. This narration uses only the saved information supplied by the editor, "
           "so any unconfirmed details must be checked before publication.")


def setup_poi(client):
    login(client, "admin")
    english = next(item for item in client.get("/api/v1/admin/languages").json() if item["code"] == "en")
    assert client.put("/api/v1/admin/languages/en", json=english | {"required": False}).status_code == 200
    payload = draft_payload() | {"status": "published", "latitude": 10.77, "longitude": 106.7,
        "auto_narration_enabled": True, "trigger_radius_m": 80,
        "translations": {"vi": {"title": "Nguồn Việt", "text": SOURCE}}}
    response = client.post("/api/v1/admin/pois", json=payload)
    assert response.status_code == 201, response.text
    return response.json(), payload


def test_radius_validation_and_drafts_do_not_change_public_release(env):
    client, factory, _ = env
    poi, payload = setup_poi(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    for patch in ({"trigger_radius_m": 19}, {"trigger_radius_m": 1001}, {"trigger_radius_m": 20.5},
                  {"latitude": None, "longitude": None}, {"latitude": 91}):
        assert client.put(endpoint, json=payload | {"revision": poi["revision"]} | patch).status_code == 422
    saved = client.put(endpoint, json=payload | {"revision": poi["revision"], "status": "draft",
                                               "trigger_radius_m": 200, "auto_narration_enabled": False}).json()
    public = client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json()
    assert public["trigger_radius_m"] == 80 and public["auto_narration_enabled"]
    assert "narration_meta" not in public and "view_count" not in public
    assert saved["trigger_radius_m"] == 200
    with factory() as db:
        assert (db.get(Poi, poi["id"]).view_count, db.get(Poi, poi["id"]).listen_count) == (0, 0)


def test_unicode_category_roundtrip_rename_preserves_id_and_relationship(env):
    client, factory, _ = env
    login(client, "admin")
    name = "Di tích lịch sử — Văn hóa 日本 العربية 한국어"
    created = client.post("/api/v1/admin/categories", json={"name": name, "name_vi": name}).json()
    poi = client.post("/api/v1/admin/pois", json=draft_payload() | {"category_id": created["id"]}).json()
    assert client.get("/api/v1/admin/categories").json()[0]
    changed = client.put(f"/api/v1/admin/categories/{created['id']}", json={"name": name + " mới", "name_vi": name + " mới"})
    assert changed.status_code == 200 and changed.json()["id"] == created["id"]
    with factory() as db:
        assert db.get(Category, created["id"]).name == name + " mới"
        assert db.get(Poi, poi["id"]).category_id == created["id"]
    assert not client.get("/api/v1/categories").json()  # Draft-only categories stay private.
    client.put(f"/api/v1/admin/pois/{poi['id']}", json=draft_payload() | {
        "category_id": created["id"], "revision": poi["revision"], "status": "published"})
    assert client.get("/api/v1/categories").json() == [{"id": created["id"], "name": name + " mới",
                                                      "name_vi": name + " mới", "color": "green"}]
    for damaged in ("Di t?ch", "Tên \ufffd", "Tên\x00"):
        assert client.post("/api/v1/admin/categories", json={"name": damaged, "name_vi": name}).status_code == 422


def queue(client, poi, codes=None, **extra):
    return client.post(f"/api/v1/admin/pois/{poi['id']}/narration-jobs", json={
        "revision": poi["revision"], "language_codes": codes or ["en"], "confirmed_source": True, **extra,
    })


def complete(client, text=ENGLISH):
    claimed = client.post("/api/v1/worker/claim", headers=WORKER, json={"protocol": 2}).json()["job"]
    response = client.post(f"/api/v1/worker/jobs/{claimed['id']}/complete", headers=WORKER, json={
        "lease": claimed["lease"], "translation": {"title": "English narration", "text": text}, "model": "mock-model",
    })
    assert response.status_code == 200, response.text
    return claimed


def test_supplement_queue_is_deduplicated_private_reviewed_and_never_creates_place(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, _ = setup_poi(client)
    # Default enabled missing locales, no Internet/model call.
    first = queue(client, poi).json()["items"]
    assert queue(client, poi).json()["items"][0]["id"] == first[0]["id"]
    assert client.get("/api/v1/health/ready").status_code == 200
    assert client.post("/api/v1/worker/claim", json={}).status_code == 401
    assert client.post("/api/v1/worker/claim", headers=WORKER, json={}).json()["job"] is None
    claimed = complete(client)
    assert claimed["payload"]["kind"] == "supplement" and claimed["payload"]["source"]["source_text"] == SOURCE.strip()
    endpoint = f"/api/v1/admin/pois/{poi['id']}/narration-jobs/{claimed['id']}/apply"
    body = {"revision": poi["revision"], "confirmed_review": False,
            "translation": {"title": "English narration", "text": ENGLISH}}
    assert client.post(endpoint, json=body).status_code == 422
    applied = client.post(endpoint, json=body | {"confirmed_review": True}).json()
    assert applied["status"] == "draft" and applied["translations"]["en"]["text"] == ENGLISH
    assert applied["narration_meta"]["en"]["model"] == "mock-model"
    assert not applied["translations"]["en"]["published"]
    public = client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json()
    assert not public["translations"].get("en", {}).get("text")
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Poi)) == 1
        assert db.scalar(select(func.count()).select_from(AiJob)) == 1
    assert queue(client, applied).status_code == 409  # No silent overwrite.
    changed = client.put(f"/api/v1/admin/pois/{poi['id']}", json={
        "name": applied["name"], "address": applied["address"], "category_id": applied["category_id"],
        "revision": applied["revision"], "translations": {"vi": {"title": "Nguồn đổi tiêu đề", "text": SOURCE}},
    }).json()
    assert changed["narration_meta"]["en"]["stale"]
    assert changed["translations"]["en"]["text"] == ENGLISH
    login(client, "editor")
    assert queue(client, applied).status_code == 403


def test_partial_failure_retry_disabled_language_and_source_conflict(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv("AI_WORKER_TOKEN", TOKEN)
    poi, payload = setup_poi(client)
    language = {"code": "ms", "name": "Malay", "native_name": "Bahasa Melayu", "speech_locale": "ms-MY"}
    assert client.post("/api/v1/admin/languages", json=language).status_code == 201
    assert queue(client, poi, ["en", "ms"]).status_code == 202
    good = complete(client)
    bad = complete(client, "Short stub")
    with factory() as db:
        assert db.get(AiJob, good["id"]).status == "completed"
        assert db.get(AiJob, bad["id"]).status == "failed"
    assert queue(client, poi, [bad["payload"]["locale"]]).status_code == 202
    assert client.put("/api/v1/admin/languages/ms", json=language | {"enabled": False}).status_code == 200
    assert queue(client, poi, ["ms"]).status_code == 422
    changed = client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload | {"revision": poi["revision"],
        "translations": {"vi": {"title": "Nguồn mới", "text": SOURCE + " Nguồn đã sửa."}}}).json()
    response = client.post(f"/api/v1/admin/pois/{poi['id']}/narration-jobs/{good['id']}/apply", json={
        "revision": changed["revision"], "confirmed_review": True,
        "translation": {"title": "English narration", "text": ENGLISH}})
    assert response.status_code == 409


def test_ollama_supplement_generation_uses_saved_source_only(monkeypatch):
    from app.narration_generation import generate_translation
    calls = []

    def fake(url, **kwargs):
        import json
        calls.append((url, kwargs))
        return {"done": True, "done_reason": "stop", "message": {"content": json.dumps({"title": "Title", "text": ENGLISH})}}

    monkeypatch.setattr("app.narration_generation.fetch_json", fake)
    result = generate_translation({"locale": "en", "language_name": "English", "source": {"source_text": SOURCE}})
    assert result["translation"]["text"] == ENGLISH
    assert calls[0][1]["local"] and calls[0][1]["timeout"] == 600


def test_postgres_concurrent_supplement_requests_share_one_active_job(env, request):
    import pytest
    from concurrent.futures import ThreadPoolExecutor
    from fastapi.testclient import TestClient
    from app.main import app
    from conftest import HEADERS

    if not request.config.getoption("--postgres"):
        pytest.skip("Row locking requires real PostgreSQL")
    client, factory, _ = env
    poi, _ = setup_poi(client)
    cookies = dict(client.cookies)

    def send(_):
        with TestClient(app, headers=HEADERS, cookies=cookies) as session:
            result = queue(session, poi)
            assert result.status_code == 202, result.text
            return result.json()["items"][0]["id"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(send, range(8)))
    assert len(set(results)) == 1
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(AiJob)) == 1

from conftest import login
from test_maps_statistics import counters, published


def test_smoke_can_read_public_details_without_recording_visits(env, monkeypatch):
    client, factory, _ = env
    poi = published(client)
    client.post("/api/v1/auth/logout")
    response = client.get(f"/api/v1/pois/{poi['id']}?track_view=false")
    assert response.status_code == 200
    assert "view_count" not in response.json() and "listen_count" not in response.json()
    assert counters(factory, poi["id"]) == (0, 0)
    monkeypatch.setenv("AI_MODE", "worker")
    assert client.get("/api/v1/health/ready").status_code == 200
    monkeypatch.setenv("RELEASE_SHA", "a" * 40)
    assert client.get("/api/v1/version").json() == {
        "release": "a" * 40, "worker_protocol": 3, "schema_revision": "0010",
    }
    assert client.get("/api/v1/admin/pois").status_code == 401
    login(client, "admin")
    assert not client.get("/api/v1/admin/ai/status").json()["ready"]

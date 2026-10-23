from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import io
import json

import pytest
from fastapi import HTTPException

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.engagement import ENGAGEMENT_COOKIE
from app.main import app
from app.models import Poi, PoiEngagement, Release, now
from conftest import HEADERS, login
from test_workflow import draft_payload


def published(client, name="Map place"):
    login(client, "admin")
    response = client.post("/api/v1/admin/pois", json=draft_payload() | {
        "name": name, "status": "published", "short_description": "A short summary",
        "latitude": 10.779, "longitude": 106.699,
    })
    assert response.status_code == 201, response.text
    return response.json()


def counters(factory, poi_id):
    with factory() as db:
        poi = db.get(Poi, poi_id)
        return poi.view_count, poi.listen_count


def test_public_order_is_popularity_then_id_and_statistics_are_private(env):
    client, factory, _ = env
    first = published(client, "First place")
    second = published(client, "Second place")
    third = published(client, "Third place")
    with factory() as db:
        db.get(Poi, third["id"]).view_count = 3
        # Old snapshots containing counters must also be sanitized.
        release = db.scalar(select(Release).where(Release.poi_id == third["id"]))
        release.snapshot = release.snapshot | {"view_count": 3, "listen_count": 7}
        db.commit()
    client.post("/api/v1/auth/logout")
    response = client.get("/api/v1/pois?locale=fr")
    items = response.json()["items"]
    assert [p["id"] for p in items] == [third["id"], *sorted([first["id"], second["id"]])]
    assert all("view_count" not in p and "listen_count" not in p for p in items)
    assert counters(factory, third["id"]) == (3, 0)  # Loading markers/list is not a view.
    assert response.headers["cache-control"] == "no-store"
    assert "HttpOnly" in response.headers["set-cookie"] or client.cookies.get(ENGAGEMENT_COOKIE)
    login(client, "editor")
    assert "view_count" not in client.get("/api/v1/admin/pois").json()["items"][0]
    assert "listen_count" not in client.get(f"/api/v1/admin/pois/{third['id']}").json()
    login(client, "admin")
    admin = client.get("/api/v1/admin/pois").json()["items"]
    assert admin[0]["id"] == third["id"] and admin[0]["view_count"] == 3


def test_views_and_listens_have_independent_rolling_windows(env, monkeypatch):
    client, factory, _ = env
    poi = published(client)
    client.post("/api/v1/auth/logout")
    stamp = now()
    monkeypatch.setattr("app.engagement.now", lambda: stamp)
    base = f"/api/v1/pois/{poi['id']}"
    client.get("/api/v1/pois")
    assert counters(factory, poi["id"]) == (0, 0)
    assert client.post(base + "/events/view").status_code == 204
    assert client.get(base).status_code == 200
    for _ in range(3):
        assert client.post(base + "/events/listen").status_code == 204
    assert counters(factory, poi["id"]) == (1, 1)
    monkeypatch.setattr("app.engagement.now", lambda: stamp + timedelta(minutes=29, seconds=59))
    client.get(base)
    client.post(base + "/events/listen")
    assert counters(factory, poi["id"]) == (1, 1)
    monkeypatch.setattr("app.engagement.now", lambda: stamp + timedelta(minutes=30))
    client.get(base)
    client.post(base + "/events/listen")
    assert counters(factory, poi["id"]) == (2, 2)
    with factory() as db:
        assert len(list(db.scalars(select(PoiEngagement)))) == 2


def test_concurrent_requests_deduplicate_and_do_not_lose_independent_visits(env):
    client, factory, _ = env
    poi = published(client)
    endpoint = f"/api/v1/pois/{poi['id']}/events/view"

    def visit(token):
        with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as visitor:
            return visitor.post(endpoint).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert list(pool.map(visit, ["a" * 64] * 12)) == [204] * 12
        assert list(pool.map(visit, [f"{i:064x}" for i in range(12)])) == [204] * 12
    assert counters(factory, poi["id"]) == (13, 0)


def test_staff_preview_and_trial_speech_do_not_increment(env):
    client, factory, _ = env
    poi = published(client)
    for role in ("admin", "editor", "reviewer"):
        login(client, role)
        assert client.get(f"/api/v1/admin/pois/{poi['id']}").status_code == 200
        assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 200
        for kind in ("view", "listen"):
            assert client.post(f"/api/v1/pois/{poi['id']}/events/{kind}").status_code == 204
    assert counters(factory, poi["id"]) == (0, 0)


def test_only_admin_can_change_places_and_counters_cannot_be_overwritten(env):
    client, _, _ = env
    poi = published(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    payload = draft_payload() | {"revision": poi["revision"], "latitude": 10.8, "longitude": 106.8}
    for role in ("editor", "reviewer"):
        login(client, role)
        assert client.post("/api/v1/admin/pois", json=payload).status_code == 403
        assert client.put(endpoint, json=payload).status_code == 403
        assert client.post(endpoint + "/actions", json={"action": "archive", "revision": poi["revision"]}).status_code == 403
        assert client.get("/api/v1/admin/map-search?q=Saigon").status_code == 403
    login(client, "admin")
    for field in ("view_count", "listen_count", "display_order"):
        assert client.put(endpoint, json=payload | {field: 123}).status_code == 422
    for coords in ({"latitude": 91}, {"longitude": 181}, {"longitude": None}):
        assert client.put(endpoint, json=payload | coords).status_code == 422
    assert client.put(endpoint, json=payload | {"address": "  "}).status_code == 422


def test_coordinates_persist_and_hiding_retains_statistics(env):
    client, factory, _ = env
    poi = published(client)
    client.post("/api/v1/auth/logout")
    client.get(f"/api/v1/pois/{poi['id']}")
    login(client, "admin")
    endpoint = f"/api/v1/admin/pois/{poi['id']}"
    payload = draft_payload() | {"revision": poi["revision"], "status": "published",
                                  "latitude": 10.78, "longitude": 106.7}
    response = client.put(endpoint, json=payload)
    assert response.status_code == 200, response.text
    saved = client.get(endpoint).json()
    assert (saved["latitude"], saved["longitude"]) == (10.78, 106.7)
    assert saved["address"] == payload["address"]
    for status in ("archived", "draft"):
        saved = client.put(endpoint, json=payload | {"revision": saved["revision"], "status": status}).json()
        assert client.get("/api/v1/pois").json()["items"] == []
        assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 404
        assert client.post(f"/api/v1/pois/{poi['id']}/events/listen").status_code == 404
        assert counters(factory, poi["id"]) == (1, 0)


def test_geocoding_requires_explicit_admin_search_and_returns_choices(env, monkeypatch):
    client, _, _ = env
    expected = [{"label": "Saigon", "latitude": 10.78, "longitude": 106.7}]
    monkeypatch.setattr("app.main.search_places", lambda query: expected)
    assert client.get("/api/v1/admin/map-search?q=Saigon").status_code == 401
    login(client, "admin")
    assert client.get("/api/v1/admin/map-search?q=Saigon").json() == {"items": expected}


def test_geocoding_validates_results_caches_searches_and_limits_requests(monkeypatch):
    from app import geocoding

    monkeypatch.setattr(geocoding, "_cache", {})
    monkeypatch.setattr(geocoding, "_last_request", 0)
    monkeypatch.setattr(geocoding.time, "monotonic", lambda: 100)
    calls = []

    def response(request, timeout):
        calls.append(request.full_url)
        return io.BytesIO(json.dumps({"features": [
            {"geometry": {"coordinates": [106.7, 10.78]}, "properties": {"name": "Saigon"}},
            {"geometry": {"coordinates": [181, 91]}, "properties": {"name": "Invalid"}},
        ]}).encode())

    monkeypatch.setattr(geocoding, "urlopen", response)
    expected = [{"label": "Saigon", "latitude": 10.78, "longitude": 106.7}]
    assert geocoding.search_places("Saigon") == expected
    assert geocoding.search_places("  Saigon  ") == expected
    assert len(calls) == 1
    with pytest.raises(HTTPException) as error:
        geocoding.search_places("Another place")
    assert error.value.status_code == 429
    monkeypatch.setattr(geocoding.time, "monotonic", lambda: 102)
    monkeypatch.setattr(geocoding, "urlopen", lambda *args, **kwargs: io.BytesIO(b"invalid JSON"))
    with pytest.raises(HTTPException) as error:
        geocoding.search_places("Another place")
    assert error.value.status_code == 502


def test_signed_in_visitor_records_engagement(env):
    client, factory, _ = env
    poi = published(client)
    client.post("/api/v1/auth/logout")
    response = client.post("/api/v1/auth/register", json={
        "name": "Visitor", "email": "map-visitor@test.local", "password": "a-visitor-password",
    })
    assert response.status_code == 201
    client.get(f"/api/v1/pois/{poi['id']}")
    client.post(f"/api/v1/pois/{poi['id']}/events/listen")
    assert counters(factory, poi["id"]) == (1, 1)

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth import digest
from app.engagement import ENGAGEMENT_COOKIE
from app.main import app
from app.models import SitePresenceSession, SiteVisitDaily, SiteVisitSession
from conftest import HEADERS, login
from test_maps_statistics import published

VISIT = "/api/v1/events/visit"
STATS = "/api/v1/admin/statistics"
PRESENCE = "/api/v1/events/presence"


def visits(factory):
    with factory() as db:
        return db.scalar(select(func.coalesce(func.sum(SiteVisitDaily.visit_count), 0)))


def test_statistics_require_admin_and_start_with_real_zeroes(env):
    client, _, _ = env
    assert client.get(STATS).status_code == 401
    for role in ("editor", "reviewer"):
        login(client, role)
        assert client.get(STATS).status_code == 403
    login(client, "admin")
    response = client.get(STATS)
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    for field in ("total_visits", "today_visits", "last_7_days_visits", "last_30_days_visits",
                  "total_views", "total_listens", "active_visitors"):
        assert data[field] == 0
    assert data["timezone"] == "Asia/Ho_Chi_Minh"
    assert len(data["daily"]) == 30
    assert all(day["visits"] == 0 for day in data["daily"])
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/register", json={
        "name": "Visitor", "email": "stats@test.local", "password": "test-password",
    }).status_code == 201
    assert client.get(STATS).status_code == 403
    assert client.post(VISIT).status_code == 204


def test_visit_cookie_rolling_window_and_persistence(env, monkeypatch):
    client, factory, _ = env
    stamp = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    monkeypatch.setattr("app.statistics.now", lambda: stamp)
    response = client.post(VISIT)
    assert response.status_code == 204
    assert response.headers["cache-control"] == "no-store"
    assert "HttpOnly" in response.headers["set-cookie"]
    token = client.cookies.get(ENGAGEMENT_COOKIE)
    assert len(token) == 64
    for _ in range(3):
        assert client.post(VISIT).status_code == 204
    monkeypatch.setattr("app.statistics.now", lambda: stamp + timedelta(minutes=29, seconds=59))
    client.post(VISIT)
    assert visits(factory) == 1
    monkeypatch.setattr("app.statistics.now", lambda: stamp + timedelta(minutes=30))
    with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as returning:
        assert returning.post(VISIT).status_code == 204
        assert returning.post(VISIT).status_code == 204
    assert visits(factory) == 2
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(SiteVisitSession)) == 1
        assert db.get(SiteVisitSession, digest(token)) is not None


def test_presence_is_session_deduplicated_expires_and_does_not_inflate_visits(env, monkeypatch):
    client, factory, _ = env
    stamp = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    monkeypatch.setattr("app.statistics.now", lambda: stamp)
    first = client.post(PRESENCE)
    assert first.status_code == 204
    assert first.headers["cache-control"] == "no-store"
    assert "HttpOnly" in first.headers["set-cookie"]
    token = client.cookies.get(ENGAGEMENT_COOKIE)
    with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as tab:
        for _ in range(3):
            assert tab.post(PRESENCE).status_code == 204
    assert visits(factory) == 0
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(SitePresenceSession)) == 1
        assert db.scalar(select(func.count()).select_from(SiteVisitSession)) == 0
    login(client, "admin")
    assert client.get(STATS).json()["active_visitors"] == 1
    stamp += timedelta(seconds=89)
    assert client.get(STATS).json()["active_visitors"] == 1
    stamp += timedelta(seconds=1)
    assert client.get(STATS).json()["active_visitors"] == 0
    with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as tab:
        assert tab.post(PRESENCE).status_code == 204
    assert client.get(STATS).json()["active_visitors"] == 1
    assert client.get(STATS).json()["active_window_seconds"] == 90
    assert visits(factory) == 0


def test_presence_excludes_staff_and_bounds_storage_without_counting_future_dates(env, monkeypatch):
    client, factory, _ = env
    stamp = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    monkeypatch.setattr("app.statistics.now", lambda: stamp)
    with factory() as db:
        db.add_all([
            SitePresenceSession(session_hash="old", last_seen_at=stamp - timedelta(days=2)),
            SitePresenceSession(session_hash="expired", last_seen_at=stamp - timedelta(seconds=90)),
            SitePresenceSession(session_hash="future", last_seen_at=stamp + timedelta(seconds=1)),
        ])
        db.commit()
    assert client.post(PRESENCE).status_code == 204
    for role in ("admin", "editor", "reviewer"):
        login(client, role)
        assert client.post(PRESENCE).status_code == 204
    login(client, "admin")
    assert client.get(STATS).json()["active_visitors"] == 0
    with factory() as db:
        assert db.get(SitePresenceSession, "old") is None
        assert db.get(SitePresenceSession, "expired") is not None
    client.post("/api/v1/auth/logout")
    assert client.post(PRESENCE, headers={"X-Requested-With": ""}).status_code == 403
    client.post("/api/v1/auth/register", json={
        "name": "Visitor", "email": "presence@test.local", "password": "test-password",
    })
    assert client.post(PRESENCE).status_code == 204
    login(client, "admin")
    assert client.get(STATS).json()["active_visitors"] == 1


def test_concurrent_presence_and_delayed_heartbeat_keep_latest_activity(env, monkeypatch):
    client, factory, _ = env
    stamp = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    monkeypatch.setattr("app.statistics.now", lambda: stamp)

    def heartbeat(token):
        with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as visitor:
            return visitor.post(PRESENCE).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert list(pool.map(heartbeat, ["a" * 64] * 12)) == [204] * 12
        assert list(pool.map(heartbeat, [f"{index:064x}" for index in range(4)])) == [204] * 4
    login(client, "admin")
    assert client.get(STATS).json()["active_visitors"] == 5
    stamp -= timedelta(seconds=30)
    assert heartbeat("a" * 64) == 204
    stamp += timedelta(seconds=119)
    assert client.get(STATS).json()["active_visitors"] == 5
    stamp += timedelta(seconds=1)
    assert client.get(STATS).json()["active_visitors"] == 0
    assert visits(factory) == 0


def test_site_visits_are_independent_of_poi_views_and_staff_preview(env):
    client, factory, _ = env
    poi = published(client)
    for role in ("admin", "editor", "reviewer"):
        login(client, role)
        assert client.post(VISIT).status_code == 204
        client.get("/api/v1/pois")
    assert visits(factory) == 0
    client.post("/api/v1/auth/logout")
    client.get("/api/v1/pois")
    client.get(f"/api/v1/pois/{poi['id']}")
    client.post(f"/api/v1/pois/{poi['id']}/events/listen")
    assert visits(factory) == 0  # Read-only API probes never create website visits.
    client.post(VISIT)
    client.post(VISIT)
    login(client, "admin")
    data = client.get(STATS).json()
    assert (data["total_visits"], data["total_views"], data["total_listens"]) == (1, 1, 1)


def test_daily_totals_use_vietnam_midnight_and_include_exact_period_boundaries(env, monkeypatch):
    client, factory, _ = env
    stamp = datetime(2026, 10, 25, 16, 59, tzinfo=timezone.utc)
    monkeypatch.setattr("app.statistics.now", lambda: stamp)
    client.post(VISIT)
    stamp += timedelta(minutes=2)  # October 26 in Vietnam, still October 25 in UTC.
    client.post(VISIT)  # Same session must not count again at midnight.
    assert visits(factory) == 1
    client.cookies.clear()
    client.post(VISIT)
    today = stamp.astimezone(timezone(timedelta(hours=7))).date()
    with factory() as db:
        db.add_all([
            SiteVisitDaily(day=today - timedelta(days=6), visit_count=3),
            SiteVisitDaily(day=today - timedelta(days=7), visit_count=5),
            SiteVisitDaily(day=today - timedelta(days=29), visit_count=7),
            SiteVisitDaily(day=today - timedelta(days=30), visit_count=11),
        ])
        db.commit()
    login(client, "admin")
    data = client.get(STATS).json()
    assert (data["total_visits"], data["today_visits"], data["last_7_days_visits"],
            data["last_30_days_visits"]) == (28, 1, 5, 17)
    assert data["daily"][0] == {"date": (today - timedelta(days=29)).isoformat(), "visits": 7}
    assert data["daily"][-1] == {"date": today.isoformat(), "visits": 1}
    assert data["daily"][-2]["visits"] == 1
    assert data["daily"][-3]["visits"] == 0
    assert sum(day["visits"] for day in data["daily"]) == 17


def test_concurrent_visit_claims_and_daily_increments_are_atomic(env):
    _, factory, _ = env

    def visit(token):
        with TestClient(app, headers=HEADERS, cookies={ENGAGEMENT_COOKIE: token}) as client:
            return client.post(VISIT).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert list(pool.map(visit, ["a" * 64] * 12)) == [204] * 12
        assert list(pool.map(visit, [f"{index:064x}" for index in range(12)])) == [204] * 12
    assert visits(factory) == 13


def test_visit_endpoint_requires_mutation_header_and_replaces_invalid_cookie(env):
    client, factory, _ = env
    assert client.post(VISIT, headers={"X-Requested-With": ""}).status_code == 403
    assert visits(factory) == 0
    client.cookies.set(ENGAGEMENT_COOKIE, "invalid")
    response = client.post(VISIT)
    assert response.status_code == 204
    assert "HttpOnly" in response.headers["set-cookie"]
    assert visits(factory) == 1

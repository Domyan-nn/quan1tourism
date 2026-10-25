from collections import defaultdict, deque
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth import COOKIE, digest, native_digest, passwords
from app.main import app
from app.models import Session, User, now
from conftest import HEADERS, login
from test_maps_statistics import counters, published

BASE = "/api/v1/native/auth"
PAYLOAD = {"name": "Native visitor", "email": "native@example.com", "password": "Native!2026"}


@pytest.fixture(autouse=True)
def isolate_limits(monkeypatch):
    monkeypatch.setattr("app.main.registration_attempts", defaultdict(deque))
    monkeypatch.setattr("app.main.login_attempts", defaultdict(deque))


def bearer(token):
    return {"Authorization": "Bearer " + token}


def test_native_registration_restart_and_logout_without_cookies(env):
    client, factory, _ = env
    response = client.post(BASE + "/register", json=PAYLOAD)
    assert response.status_code == 201, response.text
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"
    credentials = response.json()
    user, token = credentials["user"], credentials["access_token"]
    assert credentials["token_type"] == "Bearer" and credentials["expires_at"]
    assert user["role"] == "visitor"
    with factory() as db:
        assert db.get(Session, native_digest(token)).user_id == user["id"]
        assert db.get(Session, digest(token)) is None
        assert passwords.verify(PAYLOAD["password"], db.get(User, user["id"]).password_hash)
    # A fresh HTTP client models app restart; only the SecureStore token is restored.
    with TestClient(app, headers=HEADERS | bearer(token)) as restored:
        assert restored.get(BASE + "/me").json() == user
        assert restored.get("/api/v1/admin/auth/me").status_code == 403
        assert restored.get("/api/v1/admin/pois").status_code == 403
        assert restored.post(BASE + "/logout").status_code == 204
        assert restored.get(BASE + "/me").status_code == 401
    with factory() as db:
        assert db.get(Session, native_digest(token)) is None


def test_native_tokens_and_browser_cookie_sessions_are_separate(env):
    client, _, _ = env
    login(client, "admin")
    browser_token = client.cookies.get(COOKIE)
    assert client.get(BASE + "/me").status_code == 401
    assert client.get(BASE + "/me", headers=bearer(browser_token)).status_code == 401
    assert client.post(BASE + "/login", json={"email": "admin@test.local", "password": "test-password"}).status_code == 403
    credentials = client.post(BASE + "/register", json=PAYLOAD).json()
    assert client.get("/api/v1/admin/auth/me").status_code == 200  # Browser session was not replaced.
    client.cookies.clear()
    client.cookies.set(COOKIE, credentials["access_token"])
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get(BASE + "/me").status_code == 401
    assert client.get(BASE + "/me", headers=bearer(credentials["access_token"])).status_code == 200


def test_native_login_expiry_rotation_and_visitor_permission(env):
    client, factory, _ = env
    created = client.post(BASE + "/register", json=PAYLOAD).json()
    token = created["access_token"]
    response = client.post(BASE + "/login", json={"email": " NATIVE@EXAMPLE.COM ", "password": PAYLOAD["password"]},
                           headers=bearer(token))
    assert response.status_code == 200
    replacement = response.json()["access_token"]
    assert replacement != token
    assert client.get(BASE + "/me", headers=bearer(token)).status_code == 401
    with factory() as db:
        db.get(Session, native_digest(replacement)).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.get(BASE + "/me", headers=bearer(replacement)).status_code == 401
    assert client.post(BASE + "/login", json={"email": PAYLOAD["email"], "password": "incorrect"}).status_code == 401
    # Even if a user is changed to a staff role later, their native token cannot gain staff access.
    fresh = client.post(BASE + "/login", json=PAYLOAD).json()["access_token"]
    with factory() as db:
        db.get(User, created["user"]["id"]).role = "admin"
        db.commit()
    assert client.get(BASE + "/me", headers=bearer(fresh)).status_code == 401
    assert client.get("/api/v1/admin/auth/me", headers=bearer(fresh)).status_code == 401


def test_native_registration_validates_role_and_never_echoes_secrets(env):
    client, _, _ = env
    response = client.post(BASE + "/register", json=PAYLOAD | {"role": "admin"})
    assert response.status_code == 422
    assert PAYLOAD["password"] not in response.text and PAYLOAD["email"] not in response.text
    assert client.post(BASE + "/register", json=PAYLOAD).status_code == 201
    assert client.post(BASE + "/register", json=PAYLOAD).status_code == 409


def test_native_calls_keep_csrf_header_and_share_web_rate_limits(env):
    client, _, _ = env
    assert client.post(BASE + "/register", json=PAYLOAD, headers={"X-Requested-With": ""}).status_code == 403
    for index in range(10):
        path = BASE + "/login" if index % 2 else "/api/v1/auth/login"
        assert client.post(path, json={"email": PAYLOAD["email"], "password": "wrong"}).status_code == 401
    assert client.post(BASE + "/login", json=PAYLOAD).status_code == 429
    assert client.post("/api/v1/auth/login", json=PAYLOAD).status_code == 429


def test_anonymous_native_visit_header_deduplicates_after_client_restart(env):
    client, factory, _ = env
    poi = published(client)
    endpoint = f"/api/v1/pois/{poi['id']}"
    for _ in range(2):
        with TestClient(app, headers=HEADERS | {"X-Quan1-Visit": "a" * 64}) as native:
            assert native.get(endpoint).status_code == 200
            assert native.post(endpoint + "/events/listen").status_code == 204
    assert counters(factory, poi["id"]) == (1, 1)
    with TestClient(app, headers=HEADERS | {"X-Quan1-Visit": "b" * 64}) as native:
        assert native.get(endpoint).status_code == 200
        assert native.post(endpoint + "/events/listen").status_code == 204
    assert counters(factory, poi["id"]) == (2, 2)

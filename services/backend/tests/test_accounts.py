from collections import defaultdict, deque
from datetime import timedelta, timezone
from types import SimpleNamespace
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth import COOKIE, digest, passwords
from app.models import Session, User, now
from conftest import login
from test_workflow import create, publish, upload


@pytest.fixture(autouse=True)
def isolate_limits(monkeypatch):
    monkeypatch.setattr("app.main.registration_attempts", defaultdict(deque))
    monkeypatch.setattr("app.main.login_attempts", defaultdict(deque))


def payload(**changes):
    return {
        "name": "  Du khách mới  ",
        "email": "  Visitor@Example.com ",
        "password": "Visitor!2026",
    } | changes


@pytest.mark.parametrize("offset", [-7, 0, 7])
def test_session_expiry_respects_database_timezone(offset):
    from app.auth import optional_user
    session = SimpleNamespace(expires_at=(now() - timedelta(seconds=1)).astimezone(timezone(timedelta(hours=offset))))
    db = SimpleNamespace(get=lambda *args: session)
    assert optional_user(SimpleNamespace(cookies={COOKIE: "synthetic"}), db) is None


def test_registration_login_and_logout_persist_securely(env):
    client, factory, _ = env
    response = client.post("/api/v1/auth/register", json=payload())
    assert response.status_code == 201, response.text
    user = response.json()
    assert user == {
        "id": user["id"],
        "name": "Du khách mới",
        "email": "visitor@example.com",
        "role": "visitor",
    }
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    first_token = client.cookies.get(COOKIE)
    assert client.get("/api/v1/auth/me").json() == user
    with factory() as db:
        stored = db.get(User, user["id"])
        assert stored.password_hash != payload()["password"]
        assert passwords.verify(payload()["password"], stored.password_hash)
        assert db.get(Session, digest(first_token)) is not None

    assert client.post("/api/v1/auth/logout").status_code == 204
    client.cookies.set(COOKIE, first_token)
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.clear()
    assert (
        client.post("/api/v1/auth/login", json={"email": user["email"], "password": "wrong"}).status_code
        == 401
    )
    logged_in = client.post(
        "/api/v1/auth/login", json={"email": " VISITOR@EXAMPLE.COM ", "password": payload()["password"]}
    )
    assert logged_in.status_code == 200
    assert logged_in.json() == user
    second_token = client.cookies.get(COOKIE)
    assert second_token != first_token
    with factory() as db:
        session = db.get(Session, digest(second_token))
        session.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/v1/auth/me").status_code == 401


def test_duplicate_email_preserves_account_and_session(env):
    client, factory, _ = env
    assert client.post("/api/v1/auth/register", json=payload()).status_code == 201
    token = client.cookies.get(COOKIE)
    response = client.post(
        "/api/v1/auth/register", json=payload(email="visitor@example.com", password="Another!2026")
    )
    assert response.status_code == 409
    assert client.cookies.get(COOKIE) == token
    with factory() as db:
        users = list(db.scalars(select(User).where(User.role == "visitor")))
        assert len(users) == 1
        assert passwords.verify(payload()["password"], users[0].password_hash)
    assert client.post("/api/v1/auth/register", json=payload(email="ADMIN@TEST.LOCAL")).status_code == 409


@pytest.mark.parametrize(
    "changes",
    [
        {"name": " "},
        {"name": "x" * 121},
        {"email": "invalid"},
        {"email": "a@"},
        {"email": "a..b@example.com"},
        {"email": "a@-example.com"},
        {"password": "short"},
        {"password": " " * 10},
        {"password": "x" * 201},
        {"role": "admin"},
    ],
)
def test_invalid_registration_creates_no_user(env, changes):
    client, factory, _ = env
    assert client.post("/api/v1/auth/register", json=payload(**changes)).status_code == 422
    with factory() as db:
        assert not list(db.scalars(select(User).where(User.role == "visitor")))


def test_visitor_cannot_access_admin_drafts_or_private_media(env):
    client, _, _ = env
    login(client, "admin")
    draft = upload(client, create(client))
    public = publish(client, upload(client, create(client, "Địa điểm công khai khác")))
    assert client.post("/api/v1/auth/register", json=payload()).status_code == 201
    for path in (
        "/admin/auth/me",
        "/admin/categories",
        "/admin/pois",
        "/admin/summary",
        f"/admin/pois/{draft['id']}",
        f"/admin/pois/{draft['id']}/history",
    ):
        assert client.get(f"/api/v1{path}").status_code == 403, path
    assert (
        client.post("/api/v1/admin/pois", json={"name": "hack", "category_id": "test-category"}).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/v1/admin/pois/{draft['id']}", json={"name": "hack", "category_id": "test-category"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/admin/pois/{draft['id']}/actions",
            json={"action": "publish", "revision": draft["revision"]},
        ).status_code
        == 403
    )
    assert client.post("/api/v1/admin/categories", json={"name": "hack"}).status_code == 403
    assert client.delete("/api/v1/admin/categories/test-category").status_code == 403
    assert (
        client.post(
            f"/api/v1/admin/pois/{draft['id']}/upload?kind=audio&revision={draft['revision']}",
            files={"file": ("fake.wav", b"fake", "audio/wav")},
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/pois/{draft['id']}").status_code == 404
    assert client.get(f"/api/v1/media/{draft['image_id']}").status_code == 404
    assert client.get(f"/api/v1/pois/{public['id']}").status_code == 200
    assert client.get(f"/api/v1/media/{public['image_id']}").status_code == 200
    assert (
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": "visitor@example.com", "password": payload()["password"]},
        ).status_code
        == 403
    )
    login(client, "admin")
    assert client.get("/api/v1/admin/auth/me").status_code == 200
    assert client.get("/api/v1/admin/pois").status_code == 200


def test_registration_requires_csrf_header_and_is_rate_limited(env):
    client, _, _ = env
    assert (
        client.post("/api/v1/auth/register", json=payload(), headers={"X-Requested-With": ""}).status_code
        == 403
    )
    for _ in range(10):
        assert client.post("/api/v1/auth/register", json=payload(email="admin@test.local")).status_code == 409
    assert client.post("/api/v1/auth/register", json=payload()).status_code == 429


def test_account_migration_preserves_existing_users_and_sessions(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'migration.db').as_posix()}")
    monkeypatch.setattr("app.db.engine", engine)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, "0001")
    factory = sessionmaker(engine)
    with factory() as db:
        db.add(
            User(
                id="existing",
                name="Existing admin",
                email="existing@example.com",
                role="admin",
                password_hash="preserved",
            )
        )
        db.flush()
        db.add(
            Session(
                token_hash=digest("existing-token"), user_id="existing", expires_at=now() + timedelta(hours=1)
            )
        )
        db.commit()
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with factory() as db:
        assert db.get(User, "existing").password_hash == "preserved"
        assert db.get(Session, digest("existing-token")).user_id == "existing"
        db.add(User(name="Visitor", email="new@example.com", role="visitor", password_hash="hash"))
        db.commit()
    engine.dispose()

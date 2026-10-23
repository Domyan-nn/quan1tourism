import os
import uuid
import socket
from pathlib import Path

# Set before importing application modules. No test can touch the normal local database.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["QUAN1_IGNORE_LOCAL_ENV"] = "1"
os.environ["APP_ENV"] = "test"
os.environ["COOKIE_SECURE"] = "false"
os.environ.pop("RENDER", None)
os.environ.pop("STATIC_ROOT", None)

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.auth import passwords
from app.db import get_db
from app.main import app
from app.models import Category, User

HEADERS = {"X-Requested-With": "Quan1Admin"}


@pytest.fixture(autouse=True)
def no_external_network(monkeypatch):
    connect = socket.socket.connect
    def loopback_only(sock, address):
        if isinstance(address, tuple) and address[0] not in {"localhost", "127.0.0.1", "::1"}:
            raise AssertionError("Tests must mock external HTTP dependencies")
        return connect(sock, address)
    monkeypatch.setattr(socket.socket, "connect", loopback_only)


def pytest_addoption(parser):
    parser.addoption("--postgres", action="store_true", help="Run API fixtures on disposable PostgreSQL")


@pytest.fixture()
def postgres_engine():
    from sqlalchemy.engine import make_url

    value = os.getenv("TEST_POSTGRES_URL", "")
    if not value:
        pytest.fail("--postgres requires TEST_POSTGRES_URL for a disposable loopback quan1_ci database")
    url = make_url(value)
    if url.get_backend_name() != "postgresql" or url.host not in {"127.0.0.1", "localhost"} or url.database != "quan1_ci":
        pytest.fail("PostgreSQL tests only accept loopback database quan1_ci")
    admin = create_engine(url.set(drivername="postgresql+psycopg"), hide_parameters=True)
    schema = "test_" + uuid.uuid4().hex
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    engine = create_engine(url.set(drivername="postgresql+psycopg"), hide_parameters=True,
                           connect_args={"options": f"-csearch_path={schema}", "prepare_threshold": None})
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


@pytest.fixture()
def env(tmp_path, monkeypatch, request):
    database_url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    migration_engine = (request.getfixturevalue("postgres_engine") if request.config.getoption("--postgres")
                        else create_engine(database_url))
    monkeypatch.setattr("app.db.engine", migration_engine)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, "head")
    if migration_engine.dialect.name == "sqlite":
        event.listen(
            migration_engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON")
        )
    factory = sessionmaker(migration_engine, expire_on_commit=False)
    with factory() as db:
        hashed = passwords.hash("test-password")
        for role in ("editor", "reviewer", "admin"):
            db.add(User(email=f"{role}@test.local", name=role, role=role, password_hash=hashed))
        db.add(Category(id="test-category", name="Test", color="green"))
        db.commit()

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    monkeypatch.setattr("app.main.MEDIA_ROOT", tmp_path)
    with TestClient(app, headers=HEADERS) as client:
        yield client, factory, tmp_path
    app.dependency_overrides.clear()
    migration_engine.dispose()


def login(client, role="editor"):
    response = client.post(
        "/api/v1/auth/login", json={"email": f"{role}@test.local", "password": "test-password"}
    )
    assert response.status_code == 200
    return response

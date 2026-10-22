import os
from pathlib import Path

# Set before importing application modules. No test can touch the normal local database.
os.environ["DATABASE_URL"] = "sqlite://"

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


@pytest.fixture()
def env(tmp_path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    migration_engine = create_engine(database_url)
    monkeypatch.setattr("app.db.engine", migration_engine)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, "head")
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

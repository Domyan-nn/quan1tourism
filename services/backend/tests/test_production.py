import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import database_url
from app.static_site import mount_site


def test_database_url_normalizes_supabase_and_requires_tls_and_postgres():
    assert database_url("postgres://user:pass@host/db", production=True) == \
        "postgresql+psycopg://user:pass@host/db?sslmode=require"
    assert database_url("postgresql://user:pass@host/db?sslmode=verify-full", production=True).endswith(
        "sslmode=verify-full")
    for value in ("", "sqlite:///local.db", "postgres://user:pass@host/db?sslmode=disable"):
        with pytest.raises(RuntimeError):
            database_url(value, production=True)


def test_same_origin_site_does_not_mask_api_errors(tmp_path):
    (tmp_path / "admin").mkdir()
    (tmp_path / "index.html").write_text("Visitor")
    (tmp_path / "admin" / "index.html").write_text("Admin")
    app = FastAPI()
    mount_site(app, tmp_path)
    client = TestClient(app)
    assert client.get("/").text == "Visitor"
    assert client.get("/admin/").text == "Admin"
    assert client.get("/api/v1/missing").status_code == 404

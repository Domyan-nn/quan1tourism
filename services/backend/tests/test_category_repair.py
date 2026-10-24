import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


def test_category_repair_dry_run_atomic_failure_and_verified_apply(tmp_path):
    path = Path(__file__).resolve().parents[3] / "scripts" / "repair_categories.py"
    spec = importlib.util.spec_from_file_location("repair_categories", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine(f"sqlite:///{tmp_path / 'restore.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT UNIQUE)"))
        connection.execute(text("CREATE TABLE pois (id TEXT, category_id TEXT REFERENCES categories(id))"))
        connection.execute(text("INSERT INTO categories VALUES ('a','Di t?ch'),('b','V?n h?a')"))
        connection.execute(text("INSERT INTO pois VALUES ('poi','a')"))
    repairs = [{"id": "a", "expected_name": "Di t?ch", "name": "Di tích", "evidence": "verified-backup-001"}]
    result = module.repair(engine, repairs)
    assert result["mode"] == "dry-run" and result["unresolved"][0]["id"] == "b"
    with engine.connect() as connection:
        assert connection.execute(text("SELECT name FROM categories WHERE id='a'")).scalar() == "Di t?ch"
    with pytest.raises(ValueError, match="changed"):
        module.repair(engine, repairs + [{**repairs[0], "id": "b", "expected_name": "mismatch"}], apply=True)
    assert module.repair(engine, repairs, apply=True)["mode"] == "applied"
    with engine.connect() as connection:
        assert connection.execute(text("SELECT name FROM categories WHERE id='a'")).scalar() == "Di tích"
        assert connection.execute(text("SELECT category_id FROM pois WHERE id='poi'")).scalar() == "a"
    engine.dispose()

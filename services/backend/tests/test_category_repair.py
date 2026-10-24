import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


def load_repair():
    path = Path(__file__).resolve().parents[3] / "scripts" / "repair_categories.py"
    spec = importlib.util.spec_from_file_location("repair_categories", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def test_bilingual_demo_mapping_is_explicit_dry_run_and_preserves_relationships(tmp_path):
    module = load_repair()
    engine = create_engine(f"sqlite:///{tmp_path / 'bilingual.db'}")
    with engine.begin() as c:
        c.execute(text('CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT UNIQUE, name_vi TEXT)'))
        c.execute(text('CREATE TABLE pois (id TEXT, category_id TEXT REFERENCES categories(id))'))
        for entry in module.DEMO_MAPPING:
            c.execute(text('INSERT INTO categories (id,name) VALUES (:id,:expected_name)'), entry)
        c.execute(text("INSERT INTO categories VALUES ('unverified','V?n h?a',NULL)"))
        c.execute(text("INSERT INTO pois VALUES ('poi','heritage')"))
    assert module.repair(engine, module.DEMO_MAPPING)['mode'] == 'dry-run'
    with engine.connect() as c:
        assert c.execute(text("SELECT name FROM categories WHERE id='heritage'")).scalar() == 'Di tích lịch sử'
    with engine.begin() as c:
        c.execute(text("UPDATE categories SET name_vi='Đã biên tập' WHERE id='culture'"))
    with pytest.raises(ValueError, match='changed'):
        module.repair(engine, module.DEMO_MAPPING, apply=True)
    with engine.connect() as c:
        assert c.execute(text("SELECT name FROM categories WHERE id='heritage'")).scalar() == 'Di tích lịch sử'
    with engine.begin() as c:
        c.execute(text("UPDATE categories SET name_vi=NULL WHERE id='culture'"))
        c.execute(text("INSERT INTO categories VALUES ('conflict','Historical Sites','Tên khác')"))
    with pytest.raises(ValueError, match='duplicate'):
        module.repair(engine, module.DEMO_MAPPING, apply=True)
    with engine.begin() as c:
        c.execute(text("DELETE FROM categories WHERE id='conflict'"))
    result = module.repair(engine, module.DEMO_MAPPING, apply=True)
    assert result['unresolved'] == [{'id': 'unverified', 'name': 'V?n h?a', 'name_vi': None,
                                    'reasons': ['question_mark', 'missing_vietnamese_name']}]
    with engine.connect() as c:
        assert c.execute(text("SELECT name,name_vi FROM categories WHERE id='heritage'")).one() == (
            'Historical Sites', 'Di tích lịch sử')
        assert c.execute(text('SELECT category_id FROM pois')).scalar() == 'heritage'
    with pytest.raises(ValueError, match='changed'):
        module.repair(engine, module.DEMO_MAPPING, apply=True)
    engine.dispose()


def test_remote_and_production_repairs_are_refused_before_connecting(monkeypatch):
    from sqlalchemy.engine import make_url
    module = load_repair()
    assert not module.local_database(make_url('postgresql://localhost.example/test'))
    assert not module.local_database(make_url('postgresql://remote.example/test'))
    assert not module.local_database(make_url('sqlite://///remote/share/test.db'))
    monkeypatch.setenv('APP_ENV', 'production')
    engine = create_engine('sqlite://')
    with pytest.raises(ValueError, match='production'):
        module.repair(engine)
    engine.dispose()

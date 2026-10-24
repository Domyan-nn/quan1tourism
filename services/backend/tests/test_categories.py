import unicodedata
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, create_engine, select

from app.models import Audit, Category, Poi, now
from conftest import login
from test_workflow import draft_payload


def test_bilingual_create_update_unique_and_public_filtering(env):
    client, factory, _ = env
    login(client, "admin")
    vi = "Di tích lịch sử"
    response = client.post('/api/v1/admin/categories', json={
        'name': ' Historical Sites ', 'name_vi': ' ' + unicodedata.normalize('NFD', vi) + ' ', 'color': 'orange'})
    assert response.status_code == 201
    category = response.json()
    assert category == {'id': category['id'], 'name': 'Historical Sites', 'name_vi': vi, 'color': 'orange', 'count': 0}
    assert client.post('/api/v1/admin/categories', json={'name': 'Historical Sites', 'name_vi': 'Khác'}).status_code == 409
    legacy = next(c for c in client.get('/api/v1/admin/categories').json() if c['id'] == 'test-category')
    assert legacy['name_vi'] is None
    poi = client.post('/api/v1/admin/pois', json=draft_payload() | {'category_id': category['id']}).json()
    assert client.get('/api/v1/categories').json() == []
    assert client.put('/api/v1/admin/categories/' + category['id'], json={
        'name': 'Test', 'name_vi': vi}).status_code == 409
    saved = client.put('/api/v1/admin/categories/' + category['id'], json={
        'name': 'Heritage Sites', 'name_vi': 'Di sản', 'color': 'blue'})
    assert saved.status_code == 200 and saved.json()['id'] == category['id']
    with factory() as db:
        assert db.get(Poi, poi['id']).category_id == category['id']
        assert db.get(Category, category['id']).name_vi == 'Di sản'
        assert db.scalar(select(Audit).where(Audit.action == 'category_update')).detail == category['id']
    published = client.put('/api/v1/admin/pois/' + poi['id'], json=draft_payload() | {
        'category_id': category['id'], 'revision': poi['revision'], 'status': 'published'})
    assert published.status_code == 200
    public_category = {'id': category['id'], 'name': 'Heritage Sites', 'name_vi': 'Di sản', 'color': 'blue'}
    assert client.get('/api/v1/categories').json() == [public_category]
    # A newer draft must retain the current published category visibility.
    assert client.put('/api/v1/admin/pois/' + poi['id'], json=draft_payload() | {
        'category_id': category['id'], 'revision': published.json()['revision'], 'status': 'draft'}).status_code == 200
    assert client.get('/api/v1/categories').json() == [public_category]


@pytest.mark.parametrize('field', ['name', 'name_vi'])
@pytest.mark.parametrize('invalid', [None, '', '   ', 'x' * 101, 'Di t?ch', 'Tên \ufffd', 'Tên\x00', 'Tên\n'])
def test_both_category_names_are_required_and_validate_unicode(env, field, invalid):
    client, _, _ = env
    login(client, 'admin')
    data = {'name': 'Café Architecture', 'name_vi': 'Kiến trúc'}
    assert client.post('/api/v1/admin/categories', json=data | {field: invalid}).status_code == 422
    del data[field]
    assert client.post('/api/v1/admin/categories', json=data).status_code == 422
    assert client.put('/api/v1/admin/categories/test-category', json=data).status_code == 422


@pytest.mark.parametrize('role', ['editor', 'reviewer', 'admin'])
def test_existing_category_permissions_are_preserved(env, role):
    client, _, _ = env
    login(client, role)
    assert client.get('/api/v1/admin/categories').status_code == 200
    payload = {'name': 'Café Architecture', 'name_vi': 'Kiến trúc'}
    # Creation was and remains available to all editorial roles.
    created = client.post('/api/v1/admin/categories', json=payload)
    assert created.status_code == 201
    response = client.put('/api/v1/admin/categories/' + created.json()['id'], json=payload)
    assert response.status_code == (200 if role == 'admin' else 403)


def test_0010_only_adds_nullable_label_and_never_guesses_legacy_language(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    monkeypatch.setattr('app.db.engine', engine)
    config = Config(str(Path(__file__).parents[1] / 'alembic.ini'))
    config.set_main_option('script_location', str(Path(__file__).parents[1] / 'migrations'))
    command.upgrade(config, '0009')
    old = MetaData()
    old.reflect(engine)
    with engine.begin() as connection:
        connection.execute(old.tables['categories'].insert(), [
            {'id': 'heritage', 'name': 'Di tích lịch sử', 'color': 'orange'},
            {'id': 'custom', 'name': 'Tên người dùng sửa', 'color': 'blue'},
            {'id': 'broken', 'name': 'V?n h?a', 'color': 'green'},
        ])
        connection.execute(old.tables['pois'].insert().values(
            id='poi', name='Sài Gòn', address='', category_id='heritage', latitude=None, longitude=None,
            status='draft', revision=1, updated_at=now(), image_id=None, cover=0, note='', is_demo=False))
    with engine.connect() as connection:
        before = {name: connection.execute(table.select()).mappings().all() for name, table in old.tables.items()
                  if name != 'alembic_version'}
    command.upgrade(config, 'head')
    command.upgrade(config, 'head')
    with engine.connect() as connection:
        for name, values in before.items():
            assert connection.execute(old.tables[name].select()).mappings().all() == values
        assert connection.exec_driver_sql('SELECT name_vi FROM categories').all() == [(None,), (None,), (None,)]
        assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
    engine.dispose()


def test_seed_creates_bilingual_categories_without_overwriting(env, monkeypatch):
    from app.seed import seed
    client, factory, _ = env
    monkeypatch.setattr('app.seed.SessionLocal', factory)
    with factory() as db:
        db.add(Category(id='heritage', name='User edited heritage', name_vi='Tên đã sửa', color='blue'))
        db.commit()
    seed()
    seed()
    with factory() as db:
        assert db.get(Category, 'heritage').name == 'User edited heritage'
        assert db.get(Category, 'heritage').name_vi == 'Tên đã sửa'
        assert (db.get(Category, 'nature').name, db.get(Category, 'nature').name_vi) == ('Green Spaces', 'Không gian xanh')

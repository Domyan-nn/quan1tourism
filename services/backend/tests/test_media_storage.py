import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import event, select

from app.main import app
from app import media_storage as storage
from app.models import Audit, Media, Poi, Release
from conftest import HEADERS, login
from test_workflow import create, image_bytes, publish, upload


@pytest.fixture
def remote(monkeypatch):
    monkeypatch.setenv('MEDIA_STORAGE_DRIVER', 'supabase')
    monkeypatch.setenv('SUPABASE_URL', 'https://isolated-test.supabase.co')
    monkeypatch.setenv('SUPABASE_STORAGE_BUCKET', 'place-images')
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'sb_secret_' + 'synthetic_test_only_' * 2)
    class Store:
        def __init__(self):
            self.objects, self.requests, self.error = {}, [], None

        def open(self, request, timeout):
            assert timeout == 30
            self.requests.append(request)
            if self.error:
                raise self.error
            parsed = urlsplit(request.full_url)
            assert parsed.scheme == 'https' and parsed.hostname == 'isolated-test.supabase.co'
            path = unquote(parsed.path.removeprefix('/storage/v1/object/'))
            if request.method == 'POST':
                assert request.get_header('X-upsert') == 'false'
                assert path not in self.objects
                self.objects[path] = request.data
                return io.BytesIO(b'{}')
            if request.method == 'DELETE':
                for key in json.loads(request.data)['prefixes']:
                    del self.objects[path + '/' + key]
                return io.BytesIO(b'[]')
            assert path.startswith('authenticated/')
            key = path.removeprefix('authenticated/')
            if key not in self.objects:
                raise HTTPError(request.full_url, 404, 'missing', {}, io.BytesIO())
            return io.BytesIO(self.objects[key])
    fake = Store()
    def opener(handler):
        assert isinstance(handler, storage.NoStorageRedirects)
        return fake
    monkeypatch.setattr(storage, 'build_opener', opener)
    return fake


def test_supabase_image_survives_empty_restarted_filesystem_and_keeps_public_permissions(env, remote, monkeypatch):
    client, factory, directory = env
    login(client, 'admin')
    poi = upload(client, create(client))
    with factory() as db:
        media = db.get(Media, poi['image_id'])
        assert media.filename.startswith('supabase://place-images/')
    assert not list(directory.glob('*.png'))
    assert client.get(f"/api/v1/media/{poi['image_id']}").content == image_bytes()
    client.post('/api/v1/auth/logout')
    gets = sum(r.method == 'GET' for r in remote.requests)
    assert client.get(f"/api/v1/media/{poi['image_id']}").status_code == 404
    assert sum(r.method == 'GET' for r in remote.requests) == gets
    login(client, 'admin')
    poi = publish(client, poi)
    new_root = directory / 'new-empty-instance'
    monkeypatch.setattr('app.main.MEDIA_ROOT', new_root)
    with TestClient(app, headers=HEADERS) as restarted:
        result = restarted.get(f"/api/v1/media/{poi['image_id']}")
        assert result.status_code == 200 and result.content == image_bytes()
        assert result.headers['content-type'] == 'image/png'
        assert result.headers['cache-control'] == 'public, max-age=3600'
        assert 'sb_secret' not in str(dict(result.headers))
    assert not new_root.exists()
    assert all(r.get_header('Apikey') for r in remote.requests)
    assert all(not r.get_header('Authorization') for r in remote.requests)  # Modern secret != JWT.


def test_database_failure_removes_only_new_object_and_keeps_old_image(env, remote, monkeypatch):
    client, factory, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    existing = copy.deepcopy(remote.objects)
    def failed_audit(*args, **kwargs):
        raise RuntimeError('synthetic database failure')
    monkeypatch.setattr('app.main.audit', failed_audit)
    with pytest.raises(RuntimeError, match='synthetic database'):
        upload(client, poi)
    assert remote.objects == existing
    with factory() as db:
        assert db.get(Poi, poi['id']).image_id == poi['image_id']
        assert len(list(db.scalars(select(Media)))) == 1
    assert client.get(f"/api/v1/media/{poi['image_id']}").status_code == 200


def test_lost_commit_acknowledgement_does_not_delete_a_referenced_object(env, remote, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session

    client, factory, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    original = Session.commit
    def lost_ack(session):
        original(session)
        raise OperationalError('COMMIT', {}, OSError('synthetic lost acknowledgement'))
    monkeypatch.setattr(Session, 'commit', lost_ack)
    with TestClient(app, headers=HEADERS, raise_server_exceptions=False) as uncertain:
        uncertain.cookies.update(client.cookies)
        response = uncertain.post(f"/api/v1/admin/pois/{poi['id']}/upload?kind=image&revision={poi['revision']}",
                                  files={'file': ('new.png', image_bytes(), 'image/png')})
    assert response.status_code == 500
    assert 'synthetic' not in response.text
    assert len(remote.objects) == 2
    with factory() as db:
        current = db.get(Poi, poi['id'])
        assert current.image_id != poi['image_id']
        image_id = current.image_id
    assert client.get(f'/api/v1/media/{image_id}').status_code == 200


def test_upload_id_acknowledges_a_lost_response_without_new_media_or_revision(env, remote, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session

    client, factory, _ = env
    login(client, 'admin')
    poi = create(client)
    upload_id = 'a' * 32
    endpoint = f"/api/v1/admin/pois/{poi['id']}/upload"
    params = {'kind': 'image', 'revision': poi['revision'], 'upload_id': upload_id}
    original = Session.commit
    def lost_ack(session):
        original(session)
        raise OperationalError('COMMIT', {}, OSError('synthetic lost acknowledgement'))
    monkeypatch.setattr(Session, 'commit', lost_ack)
    with TestClient(app, headers=HEADERS, raise_server_exceptions=False) as uncertain:
        uncertain.cookies.update(client.cookies)
        first = uncertain.post(endpoint, params=params, files={'file': ('image.png', image_bytes(), 'image/png')})
    assert first.status_code == 500
    monkeypatch.setattr(Session, 'commit', original)
    second = client.post(endpoint, params=params, files={'file': ('image.png', image_bytes(), 'image/png')})
    assert second.status_code == 200, second.text
    assert second.json()['image_id'] == upload_id
    assert second.json()['revision'] == poi['revision'] + 1
    assert len(remote.objects) == 1
    with factory() as db:
        assert len(list(db.scalars(select(Media)))) == 1
        assert len(list(db.scalars(select(Audit).where(Audit.action == 'upload')))) == 1


def test_upload_id_cannot_reuse_another_image_or_hide_newer_revision(env, remote):
    client, _, _ = env
    login(client, 'admin')
    poi = create(client)
    endpoint = f"/api/v1/admin/pois/{poi['id']}/upload"
    params = {'kind': 'image', 'revision': poi['revision'], 'upload_id': 'b' * 32}
    uploaded = client.post(endpoint, params=params, files={'file': ('image.png', image_bytes(), 'image/png')}).json()
    other = io.BytesIO()
    Image.new('RGB', (20, 20), 'red').save(other, format='PNG')
    assert client.post(endpoint, params=params,
        files={'file': ('different.png', other.getvalue(), 'image/png')}).status_code == 409
    another = create(client, 'Another place')
    assert client.post(f"/api/v1/admin/pois/{another['id']}/upload", params=params,
        files={'file': ('image.png', image_bytes(), 'image/png')}).status_code == 409
    from test_workflow import draft_payload

    assert client.put(f"/api/v1/admin/pois/{poi['id']}",
        json=draft_payload() | {'revision': uploaded['revision']}).status_code == 200
    assert client.post(endpoint, params=params,
        files={'file': ('image.png', image_bytes(), 'image/png')}).status_code == 409
    assert len(remote.objects) == 1


@pytest.mark.parametrize('failure', ['timeout', 'credentials', 'redirect'])
def test_storage_errors_do_not_change_saved_image_or_leak_credentials(env, remote, failure):
    client, factory, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    secret_message = 'sensitive-service-credential-and-endpoint'
    remote.error = (TimeoutError(secret_message) if failure == 'timeout' else
                    HTTPError('https://sensitive.invalid/' + secret_message, 401 if failure == 'credentials' else 302,
                              secret_message, {}, io.BytesIO(secret_message.encode())))
    result = client.post(f"/api/v1/admin/pois/{poi['id']}/upload?kind=image&revision={poi['revision']}",
                         files={'file': ('new.png', image_bytes(), 'image/png')})
    assert result.status_code == 503 and result.json()['detail'] == 'media_storage_unavailable'
    assert 'sensitive' not in result.text
    with factory() as db:
        assert db.get(Poi, poi['id']).image_id == poi['image_id']
        assert len(list(db.scalars(select(Media)))) == 1


def test_production_default_requires_durable_storage_without_local_fallback(env, monkeypatch):
    client, factory, directory = env
    login(client, 'admin')
    poi = create(client)
    monkeypatch.setenv('APP_ENV', 'production')
    for key in ('MEDIA_STORAGE_DRIVER', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'):
        monkeypatch.delenv(key, raising=False)
    result = client.post(f"/api/v1/admin/pois/{poi['id']}/upload?kind=image&revision={poi['revision']}",
                         files={'file': ('new.png', image_bytes(), 'image/png')})
    assert result.status_code == 503 and result.json()['detail'] == 'media_storage_not_configured'
    assert not list(directory.glob('*.png'))
    with factory() as db:
        assert db.get(Poi, poi['id']).image_id is None
        assert not list(db.scalars(select(Media)))


def test_legacy_local_images_still_read_after_provider_changes(env, monkeypatch):
    client, _, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    monkeypatch.setenv('MEDIA_STORAGE_DRIVER', 'supabase')
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    result = client.get(f"/api/v1/media/{poi['image_id']}")
    assert result.status_code == 200 and result.content == image_bytes()


def test_wrong_or_missing_object_is_not_served_as_valid_image(env, remote):
    client, _, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    key = next(iter(remote.objects))
    remote.objects[key] = b'wrong photo bytes'
    response = client.get(f"/api/v1/media/{poi['image_id']}")
    assert response.status_code == 503 and response.json()['detail'] == 'media_integrity_failed'
    remote.objects.clear()
    assert client.get(f"/api/v1/media/{poi['image_id']}").status_code == 404


@pytest.mark.parametrize('origin', ['http://project.supabase.co', 'https://user:password@project.supabase.co',
                                  'https://attacker.invalid', 'https://project.supabase.co/?token=sensitive',
                                  'https://project.supabase.co:invalid'])
def test_storage_origin_validation_never_forwards_secret(origin, remote, monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', origin)
    with pytest.raises(HTTPException) as caught:
        storage.SupabaseStorage()
    assert caught.value.detail == 'media_storage_not_configured'
    assert not remote.requests


def test_storage_encoding_legacy_auth_and_redirect_guards(remote, monkeypatch):
    monkeypatch.setenv('SUPABASE_SECRET_KEY', '')
    legacy = 'synthetic-legacy-service-token-for-test'
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', legacy)
    client = storage.SupabaseStorage()
    key = 'folder/Ảnh, tên có dấu.png'
    reference = client.upload('place-images', key, image_bytes(), 'image/png')
    assert storage.parse_reference(reference) == ('place-images', key)
    assert '%E1%BA%A2' in remote.requests[-1].full_url and ' ' not in remote.requests[-1].full_url
    assert remote.requests[-1].get_header('Authorization') == 'Bearer ' + legacy
    with pytest.raises(HTTPException):
        storage.object_reference('place-images', '../outside.jpg')
    with pytest.raises(HTTPException):
        storage.NoStorageRedirects().redirect_request(None, None, 302, '', {}, 'https://other.invalid')


def recovery_module():
    path = Path(__file__).parents[3] / 'scripts/link_supabase_media.py'
    spec = importlib.util.spec_from_file_location('media_recovery_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_recovery_plan_requires_exact_content_hash_not_filename_or_size():
    module = recovery_module()
    raw = image_bytes()
    checksum = hashlib.sha256(raw).hexdigest()
    snapshot = {'database': {'places_with_images': [{'id': 'place', 'image_id': 'media',
        'filename': 'media.png', 'checksum': checksum, 'size': len(raw)}],
        'storage_objects': [{'bucket_id': 'place-images', 'name': 'original-name.png'}]}}
    class Remote:
        def download(self, bucket, key):
            return raw
    before = copy.deepcopy(snapshot)
    result = module.build_plan(snapshot, Remote())
    assert snapshot == before and not result['mutation_performed']
    assert result['entries'][0]['filename'] == 'supabase://place-images/original-name.png'
    snapshot['database']['places_with_images'][0]['checksum'] = '0' * 64
    assert not module.build_plan(snapshot, Remote())['entries']


def test_reviewed_recovery_preserves_poi_publication_and_records_audit(env):
    module = recovery_module()
    client, factory, _ = env
    login(client, 'admin')
    poi = publish(client, upload(client, create(client)))
    with factory() as db:
        media = db.get(Media, poi['image_id'])
        release = db.scalar(select(Release).where(Release.poi_id == poi['id'], Release.is_current.is_(True)))
        before = copy.deepcopy(release.snapshot)
        old_filename = media.filename
        row = {'media_id': media.id, 'poi_id': poi['id'], 'expected_filename': old_filename,
               'filename': 'supabase://place-images/original.png', 'checksum': media.checksum, 'size': media.size}
    plan = {'entries': [row]}
    def verified(reference, size, checksum):
        assert reference == row['filename'] and size == row['size'] and checksum == row['checksum']
        return image_bytes()
    assert module.apply_plan(factory.kw['bind'], plan, verify=verified) == 1
    with factory() as db:
        assert db.get(Media, poi['image_id']).filename == row['filename']
        current = db.get(Poi, poi['id'])
        assert current.image_id == poi['image_id'] and current.revision == poi['revision'] and current.status == 'published'
        assert db.scalar(select(Release).where(Release.poi_id == poi['id'], Release.is_current.is_(True))).snapshot == before
        assert db.scalar(select(Audit).where(Audit.action == 'media_storage_link')).poi_id == poi['id']
    with pytest.raises(ValueError):
        module.apply_plan(factory.kw['bind'], plan, verify=verified)  # A stale plan cannot overwrite a new locator.


def test_recovery_verification_failure_performs_no_database_write(env):
    module = recovery_module()
    client, factory, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    with factory() as db:
        media = db.get(Media, poi['image_id'])
        old = media.filename
        row = {'media_id': media.id, 'poi_id': poi['id'], 'expected_filename': old,
               'filename': 'supabase://place-images/unknown.png', 'checksum': media.checksum, 'size': media.size}
    def missing(*args):
        raise HTTPException(404, 'media_file_not_found')
    with pytest.raises(HTTPException):
        module.apply_plan(factory.kw['bind'], {'entries': [row]}, verify=missing)
    with factory() as db:
        assert db.get(Media, poi['image_id']).filename == old
        assert not db.scalar(select(Audit).where(Audit.action == 'media_storage_link'))


def test_media_inventory_collector_is_read_only_and_keeps_source_hashes(env):
    client, factory, _ = env
    login(client, 'admin')
    poi = upload(client, create(client))
    path = Path(__file__).parents[3] / 'scripts/audit_media_storage.py'
    spec = importlib.util.spec_from_file_location('media_inventory_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = factory.kw['bind']
    commands = []
    def record(conn, cursor, statement, params, context, many):
        commands.append(statement.strip().split()[0].upper())
    event.listen(engine, 'before_cursor_execute', record)
    try:
        result = module.collect_snapshot(engine, 'place-images')
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert result['read_only'] and not result['mutation_performed']
    row = result['database']['places_with_images'][0]
    assert row['image_id'] == poi['image_id'] and row['checksum'] == hashlib.sha256(image_bytes()).hexdigest()
    assert set(commands) <= {'SELECT', 'SET', 'SHOW', 'PRAGMA'}

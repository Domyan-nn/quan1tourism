import copy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import event, select

from app.models import AiJob, Poi, now
from app.narration_generation import GenerationFailure
from conftest import login
from test_ai_jobs import TOKEN, WORKER, enqueue as enqueue_wikipedia
from test_location_narration import setup_poi, ENGLISH, SOURCE
from test_wikipedia import upstream, URL  # noqa: F401


def queue(client, poi, codes=None):
    response = client.post(f"/api/v1/admin/pois/{poi['id']}/narration-jobs", json={
        'revision': poi['revision'], 'language_codes': codes if codes is not None else ['en'], 'confirmed_source': True})
    return response


def claim(client):
    return client.post('/api/v1/worker/claim', json={'protocol': 3}, headers=WORKER).json()['job']


def completion(client, job, tr=None, **overrides):
    context = {key: job['payload'][key] for key in ('locale', 'source_revision', 'source_hash') if key in job['payload']}
    return client.post(f"/api/v1/worker/jobs/{job['id']}/complete", headers=WORKER, json={
        'lease': job['lease'], **context, 'translation': tr, 'model': 'mock', 'done_reason': 'stop', **overrides})


@pytest.mark.parametrize('locale', ['en', 'fr', 'de', 'es', 'it', 'pt', 'id', 'ar'])
def test_completion_cannot_bypass_worker_source_copy_validation(env, monkeypatch, locale):
    client, factory, _ = env
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    poi, _ = setup_poi(client)
    assert queue(client, poi, [locale]).status_code == 202
    job = claim(client)
    source = job['payload']['source']['source_text']
    response = completion(client, job, {'title': 'Copied', 'text': source},
                          validation={'status': 'passed', 'issues': []})
    assert response.status_code == 200
    assert response.json()['status'] == 'failed' and 'source_copy' in response.json()['issue_codes']
    with factory() as db:
        assert db.get(AiJob, job['id']).result is None
        assert not db.get(Poi, poi['id']).translations.get(locale, {}).get('text')


def test_policy_explicit_selection_and_partial_results(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    poi, _ = setup_poi(client)
    assert queue(client, poi, []).status_code == 422
    assert queue(client, poi, ['en', 'fr']).json()['detail'] == 'batch_limited'
    monkeypatch.setenv('AI_TRANSLATION_BATCH_LIMIT', '2')
    assert queue(client, poi, ['en', 'fr']).json()['detail'] == 'language_not_verified'
    monkeypatch.setenv('AI_TRANSLATION_VERIFIED_LOCALES', 'en,fr')
    response = queue(client, poi, ['en', 'fr'])
    assert response.status_code == 202 and len(response.json()['items']) == 2
    assert queue(client, poi, ['en', 'fr']).json()['items'][0]['id'] == response.json()['items'][0]['id']
    first = claim(client)
    assert claim(client) is None  # One live inference globally.
    assert completion(client, first, {'title': 'English', 'text': ENGLISH}).json()['status'] == 'completed'
    second = claim(client)
    assert completion(client, second, error='source_copy', issue_codes=['source_copy', 'wrong_language']).json()['status'] == 'failed'
    result = client.get(f"/api/v1/admin/pois/{poi['id']}/narration-jobs").json()
    assert sum(j['reviewable'] for j in result['items']) == 1
    assert sum(j['status'] == 'failed' for j in result['items']) == 1
    assert next(j for j in result['items'] if j['status'] == 'failed')['issue_codes'] == ['source_copy', 'wrong_language']
    assert all(j['timings']['queue_wait_seconds'] is not None for j in result['items'])
    with factory() as db:
        assert db.get(Poi, poi['id']).translations.get('en', {}).get('text', '') == ''


def test_known_codes_identities_stale_results_and_idempotence(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    poi, _ = setup_poi(client)
    queue(client, poi)
    job = claim(client)
    good = {'title': 'English', 'text': ENGLISH}
    assert completion(client, job, good, locale='fr').status_code == 409
    assert completion(client, job, good, source_hash='bad').status_code == 409
    assert completion(client, job, good, done_reason='length').json()['issue_codes'][0] == 'incomplete_generation'
    # A later duplicate callback cannot upgrade or overwrite a terminal failure.
    assert completion(client, job, good).json()['status'] == 'failed'
    queue(client, poi)
    next_job = claim(client)
    assert completion(client, next_job, error='model_timeout', issue_codes=['model_timeout']).json()['issue_codes'] == ['model_timeout']
    queue(client, poi)
    another = claim(client)
    response = completion(client, another, error='https://secret.invalid?token=private', issue_codes=['unsafe'])
    assert response.json()['issue_codes'] == ['generation_failed']
    with factory() as db:
        assert 'secret' not in db.get(AiJob, another['id']).error
    queue(client, poi)
    stale = claim(client)
    with factory() as db:
        place = db.get(Poi, poi['id'])
        values = dict(place.translations)
        values['vi'] = {'title': 'Nguồn mới', 'text': SOURCE + ' Nguồn được người biên tập sửa lại.'}
        place.translations = values
        db.commit()
    assert completion(client, stale, good).json()['issue_codes'] == ['source_changed']


def test_legacy_false_completed_is_not_reviewable_or_applied(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    poi, _ = setup_poi(client)
    item = queue(client, poi).json()['items'][0]
    with factory() as db:
        job = db.get(AiJob, item['id'])
        job.status = 'completed'
        job.result = {'translation': {'title': 'Copied', 'text': SOURCE}, 'model': 'old-model'}
        db.commit()
    old = client.get(f"/api/v1/admin/pois/{poi['id']}/narration-jobs").json()['items'][0]
    assert old['status'] == 'completed' and not old['reviewable'] and 'source_copy' in old['issue_codes']
    response = client.post(f"/api/v1/admin/pois/{poi['id']}/narration-jobs/{item['id']}/apply", json={
        'revision': poi['revision'], 'confirmed_review': True, 'translation': {'title': 'Copied', 'text': SOURCE}})
    assert response.status_code == 422 and response.json()['detail'] == 'source_copy'


def test_creation_job_and_worker_also_reject_wrong_language(env, upstream, monkeypatch):  # noqa: F811
    from app.wikipedia import generate_draft
    from fastapi import HTTPException

    client, factory, _ = env
    login(client, 'admin')
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    monkeypatch.setenv('AI_MODE', 'worker')
    job_id = enqueue_wikipedia(client)
    job = claim(client)
    payload = job['payload']
    draft = generate_draft(URL, payload['categories'], payload['languages'], article=payload['article'])
    draft['draft']['translations']['en'] = {'title': 'Copied', 'text': payload['article']['text']}
    response = completion(client, job, draft=draft['draft'])
    assert response.json()['status'] == 'failed'
    assert 'source_copy' in response.json()['issue_codes']
    with factory() as db:
        assert db.get(AiJob, job_id).result is None
        assert not list(db.scalars(select(Poi)))
    # Worker path uses exactly the same validator before making a callback.
    original = __import__('app.wikipedia', fromlist=['fetch_json']).fetch_json
    def copied(url, **kwargs):
        result = original(url, **kwargs)
        if url.endswith('/api/chat'):
            data = json.loads(result['message']['content'])
            data['translations']['en'] = {'title': 'Copied', 'text': payload['article']['text']}
            result['message']['content'] = json.dumps(data)
        return result
    monkeypatch.setattr('app.wikipedia.fetch_json', copied)
    with pytest.raises(HTTPException) as caught:
        generate_draft(URL, payload['categories'], payload['languages'], article=payload['article'])
    assert caught.value.detail == 'source_copy'


def test_worker_preserves_codes_and_uses_validator(monkeypatch):
    from test_ollama_worker import worker

    payload = {'kind': 'supplement', 'locale': 'fr', 'source_revision': 3, 'source_hash': 'hash',
               'source': {'source_locale': 'vi', 'source_text': SOURCE}}
    def bad(*args, **kwargs):
        return {'done': True, 'done_reason': 'stop', 'message': {'content': json.dumps({'title': 'Copied', 'text': SOURCE})}}
    monkeypatch.setattr('app.narration_generation.fetch_json', bad)
    result = worker.process_job({'lease': 'lease', 'payload': payload})
    assert result['error'] == 'source_copy' and result['locale'] == 'fr' and result['source_hash'] == 'hash'
    assert 'translation' not in result
    def timeout(*args, **kwargs):
        raise GenerationFailure(['model_timeout'])
    monkeypatch.setattr('app.narration_generation.generate_translation', timeout)
    assert worker.process_job({'lease': 'lease', 'payload': payload})['error'] == 'model_timeout'


def test_audit_snapshot_is_read_only_and_does_not_equate_jobs_with_publications(env):
    path = Path(__file__).parents[3] / 'scripts/audit_ai_translations.py'
    spec = importlib.util.spec_from_file_location('translation_audit', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    snapshot = {'jobs': [{'id': 'old-copy', 'status': 'completed', 'payload': {
        'kind': 'supplement', 'poi_id': 'place', 'locale': 'fr', 'source_revision': 2,
        'source': {'source_locale': 'vi', 'source_text': SOURCE}},
        'result': {'translation': {'title': 'Copied', 'text': SOURCE}}}],
        'places': [{'id': 'place', 'revision': 4, 'narration_meta': {'fr': {'origin': 'manual'}}}],
        'translations': [{'poi_id': 'place', 'locale': 'vi', 'title': 'Nguồn', 'text': SOURCE},
                         {'poi_id': 'place', 'locale': 'fr', 'title': 'Manual', 'text': ENGLISH}], 'releases': []}
    before = copy.deepcopy(snapshot)
    report = module.audit(snapshot)
    assert snapshot == before and report['mutation_performed'] is False
    job = next(r for r in report['reports'] if r['scope'] == 'job')
    assert 'source_copy' in job['validation']['issues']
    assert not job['saved_exactly'] and not job['currently_published_exactly'] and job['manual_edit_evidence']
    assert not report['regeneration_plan']['ready']


def test_pending_limit_deduplication_and_operator_pause_are_enforced(env, monkeypatch):
    client, _, _ = env
    poi, _ = setup_poi(client)
    first = queue(client, poi, ['en']).json()['items'][0]['id']
    assert queue(client, poi, ['fr']).status_code == 202
    assert queue(client, poi, ['de']).status_code == 202
    assert queue(client, poi, ['es']).status_code == 429
    assert queue(client, poi, ['en']).json()['items'][0]['id'] == first
    monkeypatch.setenv('AI_TRANSLATION_ENABLED', 'false')
    assert queue(client, poi, ['it']).json()['detail'] == 'language_not_verified'
    assert client.get(f"/api/v1/admin/pois/{poi['id']}").status_code == 200


def test_protocol_lease_reclaim_and_heartbeat_cannot_accept_old_callbacks(env, monkeypatch):
    client, factory, _ = env
    monkeypatch.setenv('AI_WORKER_TOKEN', TOKEN)
    poi, _ = setup_poi(client)
    queue(client, poi)
    assert client.post('/api/v1/worker/claim', json={'protocol': 2}, headers=WORKER).json()['job'] is None
    old = claim(client)
    def heartbeat(lease):
        return client.post('/api/v1/worker/heartbeat', headers=WORKER, json={
            'model': 'mock', 'ready': True, 'protocol': 3, 'job_id': old['id'], 'lease': lease})
    assert heartbeat('wrong-lease').status_code == 200
    with factory() as db:
        assert 'last_heartbeat_at' not in db.get(AiJob, old['id']).payload['execution']
    assert heartbeat(old['lease']).status_code == 200
    with factory() as db:
        job = db.get(AiJob, old['id'])
        last_heartbeat = job.payload['execution']['last_heartbeat_at']
        assert last_heartbeat
        job.lease_until = now() - timedelta(seconds=1)
        db.commit()
    heartbeat(old['lease'])
    with factory() as db:
        assert db.get(AiJob, old['id']).payload['execution']['last_heartbeat_at'] == last_heartbeat
    current = claim(client)
    assert current['id'] == old['id'] and current['lease'] != old['lease']
    good = {'title': 'English', 'text': ENGLISH}
    assert completion(client, old, good).status_code == 409
    assert completion(client, current, good).json()['status'] == 'completed'
    queue(client, poi, ['fr'])
    with factory() as db:
        job = db.scalar(select(AiJob).where(AiJob.status == 'queued'))
        job.payload = {k: v for k, v in job.payload.items() if k != 'validation_contract'}
        db.commit()
    assert claim(client) is not None  # Updated worker can still process legacy jobs.


def test_audit_database_collector_uses_verified_read_only_transaction(env):
    client, factory, _ = env
    poi, _ = setup_poi(client)
    queue(client, poi)
    path = Path(__file__).parents[3] / 'scripts/audit_ai_translations.py'
    spec = importlib.util.spec_from_file_location('collector_audit', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    statements = []
    engine = factory.kw['bind']
    def record(connection, cursor, statement, parameters, context, many):
        statements.append(statement.strip().split()[0].upper())
    event.listen(engine, 'before_cursor_execute', record)
    try:
        first = module.collect_snapshot(engine)
        second = module.collect_snapshot(engine)
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert first == second
    assert first['jobs'][0]['status'] == 'queued'
    assert set(statements) <= {'SELECT', 'SET', 'SHOW', 'PRAGMA'}

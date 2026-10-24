"""Read-only historical audit. No app DB defaults, mutation, repair or enqueue."""
import argparse
from collections import Counter
import json
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/backend'))
from app.translation_validation import VALIDATOR_VERSION, validate_translation, validate_draft_translations  # noqa: E402


def collect_snapshot(engine):
    from sqlalchemy import text

    with engine.connect() as connection:
        if engine.dialect.name == 'postgresql':
            connection.execute(text('SET TRANSACTION READ ONLY'))
            if connection.scalar(text('SHOW transaction_read_only')) != 'on':
                raise RuntimeError('Read-only transaction could not be verified')
        elif engine.dialect.name == 'sqlite':
            connection.exec_driver_sql('PRAGMA query_only=ON')
        else:
            raise RuntimeError('Unsupported database')
        data = {name: [dict(row) for row in connection.execute(text(sql)).mappings()] for name, sql in {
            'jobs': 'SELECT id,status,payload,result,error,created_at,updated_at FROM ai_jobs ORDER BY created_at',
            'places': 'SELECT id,revision,narration_meta FROM pois',
            'translations': 'SELECT poi_id,locale,title,text FROM poi_translations',
            'releases': 'SELECT id,poi_id,revision,is_current,snapshot FROM content_releases',
        }.items()}
        for job in data['jobs']:
            for field in ('payload', 'result'):
                if isinstance(job[field], str):
                    job[field] = json.loads(job[field])
        for place in data['places']:
            if isinstance(place['narration_meta'], str):
                place['narration_meta'] = json.loads(place['narration_meta'])
        for release in data['releases']:
            if isinstance(release['snapshot'], str):
                release['snapshot'] = json.loads(release['snapshot'])
        connection.rollback()
        return data


def audit(snapshot):
    reports = []
    translations = {(row['poi_id'], row['locale']): row for row in snapshot.get('translations', [])}
    places = {p['id']: p for p in snapshot.get('places', [])}
    releases = snapshot.get('releases', [])
    for job in snapshot.get('jobs', []):
        payload, result = job.get('payload') or {}, job.get('result') or {}
        if payload.get('kind') != 'supplement':
            if result.get('draft') and payload.get('article'):
                validations = validate_draft_translations(payload['article'], result['draft'].get('translations', {}))
                for locale, validation in validations.items():
                    reports.append({'scope': 'creation_job', 'job_id': job['id'], 'locale': locale,
                        'state': job['status'], 'source_confidence': 'article_snapshot',
                        'validation': validation.to_dict(), 'admin_review_required': not validation.passed})
            continue
        locale, poi_id = payload.get('locale'), payload.get('poi_id')
        tr = result.get('translation')
        if tr is None:
            continue  # Failure without retained output cannot be reconstructed.
        source = payload.get('source', {})
        validation = validate_translation(source.get('source_text', ''), source.get('source_locale', 'vi'), tr, locale)
        saved = translations.get((poi_id, locale))
        saved_exactly = bool(saved and all(saved.get(k) == tr.get(k) for k in ('title', 'text')))
        published = [r['id'] for r in releases if r['poi_id'] == poi_id and r.get('is_current') and
                     all(r['snapshot'].get('translations', {}).get(locale, {}).get(k) == tr.get(k) for k in ('title', 'text'))]
        meta = (places.get(poi_id, {}).get('narration_meta') or {}).get(locale, {})
        reports.append({'scope': 'job', 'job_id': job['id'], 'poi_id': poi_id, 'locale': locale,
            'state': job['status'], 'source_revision': payload.get('source_revision'),
            'source_hash': payload.get('source_hash'),
            'source_confidence': 'job_source_snapshot' if source.get('source_text') else 'unknown',
            'validation': validation.to_dict(), 'saved_exactly': saved_exactly,
            'currently_published_exactly': published,
            'manual_edit_evidence': meta.get('origin') == 'manual',
            'changed_since_job': bool(saved and not saved_exactly and saved.get('text')),
            'admin_review_required': not validation.passed})
    # Saved text has no reliable historical source unless it matches a job or
    # carries provenance linking it to a job source snapshot. Do not infer facts
    # about old translations from the current Vietnamese draft.
    for (poi_id, locale), tr in translations.items():
        if locale == 'vi' or not tr.get('text', '').strip():
            continue
        linked = next((r for r in reports if r.get('scope') == 'job' and r.get('poi_id') == poi_id
                       and r.get('locale') == locale and r.get('saved_exactly')), None)
        source = translations.get((poi_id, 'vi'), {})
        validation = (linked['validation'] if linked else validate_translation(
            source.get('text', ''), 'vi', {k: tr.get(k, '') for k in ('title', 'text')}, locale).to_dict())
        meta = (places.get(poi_id, {}).get('narration_meta') or {}).get(locale, {})
        reports.append({'scope': 'saved_translation', 'poi_id': poi_id, 'locale': locale,
            'source_confidence': 'linked_job_snapshot' if linked else 'current_source_unproven_for_history',
            'validation': validation, 'saved': True, 'manual_edit_evidence': meta.get('origin') == 'manual',
            'admin_review_required': not linked or validation['status'] != 'passed'})
    for release in releases:
        snapshot_data = release.get('snapshot') or {}
        values = snapshot_data.get('translations') or {}
        source = values.get('vi', {}).get('text', '')
        for locale, tr in values.items():
            if locale == 'vi' or not tr.get('text', '').strip():
                continue
            validation = validate_translation(source, 'vi', {k: tr.get(k, '') for k in ('title', 'text')}, locale)
            reports.append({'scope': 'release', 'release_id': release['id'], 'poi_id': release['poi_id'],
                'locale': locale, 'published': bool(release.get('is_current')),
                'source_confidence': 'same_release_source' if source else 'unknown',
                'validation': validation.to_dict(), 'admin_review_required': not validation.passed or not source})
    counts = Counter((r['scope'], r['validation']['status']) for r in reports)
    suspects = [r for r in reports if r['admin_review_required']]
    return {'validator_version': VALIDATOR_VERSION, 'read_only': True, 'mutation_performed': False,
            'counts': {scope + ':' + status: n for (scope, status), n in sorted(counts.items())},
            'failed_jobs_without_output': sum(j['status'] == 'failed' and not j.get('result') for j in snapshot.get('jobs', [])),
            'reports': reports, 'needs_admin_review': len(suspects),
            'regeneration_plan': {'ready': False, 'reason': 'Requires model benchmark and administrator source/history review',
                'candidates_for_review_only': [{'job_id': r.get('job_id'), 'poi_id': r.get('poi_id'), 'locale': r['locale']}
                                             for r in suspects if r['scope'] == 'job' and not r.get('manual_edit_evidence')]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--snapshot', type=Path)
    source.add_argument('--database', action='store_true', help='Only TRANSLATION_AUDIT_DATABASE_URL is read')
    parser.add_argument('--allow-remote-read', action='store_true')
    parser.add_argument('--save-snapshot', type=Path, help='Private local evidence; contains narration text')
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/translation-audit.json')
    args = parser.parse_args()
    if args.database:
        from sqlalchemy import create_engine
        from sqlalchemy.engine import make_url

        raw = os.getenv('TRANSLATION_AUDIT_DATABASE_URL', '')
        if not raw:
            parser.error('Set the dedicated audit URL through a secret manager; no application default is used')
        url = make_url(raw)
        if url.get_backend_name() == 'postgresql':
            if url.host not in {'127.0.0.1', 'localhost'} and not args.allow_remote_read:
                parser.error('Remote reads require --allow-remote-read')
            url = url.set(drivername='postgresql+psycopg').update_query_dict({'sslmode': 'require'} if url.host not in {'127.0.0.1', 'localhost'} else {})
        elif url.get_backend_name() != 'sqlite' or not Path(url.database or '').is_file():
            parser.error('Use an existing local SQLite restore or an explicit PostgreSQL audit URL')
        engine = create_engine(url, hide_parameters=True)
        try:
            snapshot_data = collect_snapshot(engine)
        finally:
            engine.dispose()
    else:
        snapshot_data = json.loads(args.snapshot.read_text(encoding='utf-8'))
    if args.save_snapshot:
        if not args.save_snapshot.resolve().is_relative_to(ROOT / '.runtime'):
            parser.error('Raw business snapshots must stay in gitignored .runtime')
        args.save_snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.save_snapshot.write_text(json.dumps(snapshot_data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    report = audit(snapshot_data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('read_only', 'mutation_performed', 'counts', 'needs_admin_review')}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Read-only audit failed; no database writes were performed. Inspect local inputs without logging credentials.')

"""Read-only inventory for hash-verified image recovery; no app DB defaults."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def collect_snapshot(engine, bucket):
    from sqlalchemy import text

    with engine.connect() as connection:
        if engine.dialect.name == 'postgresql':
            connection.execute(text('SET TRANSACTION READ ONLY'))
            if connection.scalar(text('SHOW transaction_read_only')) != 'on':
                raise RuntimeError('Read-only transaction unavailable')
        elif engine.dialect.name == 'sqlite':
            connection.exec_driver_sql('PRAGMA query_only=ON')
        else:
            raise RuntimeError('Unsupported database')
        rows = [dict(r) for r in connection.execute(text('''
            SELECT p.id,p.name,p.image_id,m.filename,m.size,m.checksum
            FROM pois p JOIN media_assets m ON m.id=p.image_id ORDER BY p.id
        ''')).mappings()]
        available = engine.dialect.name == 'postgresql' and connection.scalar(text("SELECT to_regclass('storage.objects')"))
        objects = [dict(r) for r in connection.execute(text('''
            SELECT bucket_id,name,metadata->>'size' AS bytes FROM storage.objects
            WHERE bucket_id=:bucket ORDER BY created_at LIMIT 1001
        '''), {'bucket': bucket}).mappings()] if available else []
        if len(objects) > 1000:
            raise RuntimeError('Inventory exceeds the small repair limit; narrow the reviewed bucket')
        connection.rollback()
    return {'read_only': True, 'mutation_performed': False, 'database': {
        'places_with_images': rows, 'storage_objects': objects, 'storage_metadata_available': bool(available)}}


def main():
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bucket', default='place-images')
    parser.add_argument('--allow-remote-read', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/media-storage-snapshot.json')
    args = parser.parse_args()
    raw = os.getenv('MEDIA_AUDIT_DATABASE_URL', '')
    if not raw:
        parser.error('Set dedicated MEDIA_AUDIT_DATABASE_URL; DATABASE_URL/local.env are not used')
    if not args.output.resolve().is_relative_to(ROOT / '.runtime'):
        parser.error('Private inventories must remain in gitignored .runtime')
    url = make_url(raw)
    if url.get_backend_name() == 'postgresql':
        remote = url.host not in {'127.0.0.1', 'localhost'}
        if remote and not args.allow_remote_read:
            parser.error('Remote inventory requires --allow-remote-read')
        url = url.set(drivername='postgresql+psycopg')
        if remote:
            url = url.update_query_dict({'sslmode': 'require'})
    elif url.get_backend_name() != 'sqlite' or not Path(url.database or '').is_file():
        parser.error('Use explicit PostgreSQL or an existing local SQLite restore')
    engine = create_engine(url, hide_parameters=True)
    try:
        result = collect_snapshot(engine, args.bucket)
    finally:
        engine.dispose()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'read_only': True, 'media_count': len(result['database']['places_with_images']),
                      'object_count': len(result['database']['storage_objects'])}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Read-only inventory failed; no application data was changed. Check configuration without printing credentials.')

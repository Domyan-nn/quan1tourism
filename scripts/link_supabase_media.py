"""Hash-verified recovery of existing Supabase objects; dry-run by default.

Plan from a private read-only diagnosis snapshot; only --apply updates locators.
Never uploads/deletes a remote object or changes POIs/publication snapshots.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/backend"))
from app import config  # noqa: E402,F401
from app.media_storage import SupabaseStorage, object_reference, read_remote_image, parse_reference  # noqa: E402


def build_plan(snapshot, storage):
    data = snapshot["database"]
    objects = []
    for item in data["storage_objects"]:
        raw = storage.download(item["bucket_id"], item["name"])
        objects.append({"reference": object_reference(item["bucket_id"], item["name"]),
                        "checksum": hashlib.sha256(raw).hexdigest(), "size": len(raw)})
    entries, unmatched = [], []
    for row in data["places_with_images"]:
        matches = [obj for obj in objects if obj["checksum"] == row["checksum"] and obj["size"] == row["size"]]
        if len(matches) != 1:
            unmatched.append({"media_id": row["image_id"], "reason": "missing_or_ambiguous_hash_match"})
            continue
        entries.append({"media_id": row["image_id"], "poi_id": row["id"], "expected_filename": row["filename"],
                        "filename": matches[0]["reference"], "checksum": row["checksum"], "size": row["size"]})
    return {"version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
            "mutation_performed": False, "entries": entries, "unmatched": unmatched}


def apply_plan(engine, plan, verify=read_remote_image):
    from sqlalchemy import text

    entries = plan["entries"]
    if not entries or len({r["media_id"] for r in entries}) != len(entries):
        raise ValueError("Plan must have unique nonempty media entries")
    for row in entries:
        if not parse_reference(row["filename"]) or row["filename"] == row["expected_filename"]:
            raise ValueError("Plan must link a distinct verified remote object")
        verify(row["filename"], row["size"], row["checksum"])
    with engine.begin() as connection:
        locked = []
        for row in entries:
            query = """SELECT m.id,m.poi_id,m.filename,m.checksum,m.size,p.image_id
                FROM media_assets m JOIN pois p ON p.id=m.poi_id WHERE m.id=:media_id"""
            if engine.dialect.name == "postgresql":
                query += " FOR UPDATE OF m,p"
            current = connection.execute(text(query), {"media_id": row["media_id"]}).mappings().one_or_none()
            if not current or any(current[k] != row[v] for k, v in {
                "poi_id": "poi_id", "filename": "expected_filename", "checksum": "checksum", "size": "size",
                "image_id": "media_id"}.items()):
                raise ValueError("Media or place changed; rebuild the recovery plan")
            locked.append(row)
        for row in locked:
            changed = connection.execute(text("""UPDATE media_assets SET filename=:filename
                WHERE id=:media_id AND filename=:expected_filename AND checksum=:checksum"""), row)
            if changed.rowcount != 1:
                raise ValueError("Media changed; no recovery was committed")
            connection.execute(text("""INSERT INTO audit_logs (poi_id,actor,action,detail,created_at)
                VALUES (:poi_id,'media-storage-repair','media_storage_link',:detail,:at)"""), {
                    "poi_id": row["poi_id"], "detail": json.dumps({"media_id": row["media_id"],
                        "before": row["expected_filename"], "after": row["filename"], "checksum": row["checksum"]}),
                    "at": datetime.now(timezone.utc)})
    return len(entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, help="Private output of read-only media diagnosis")
    parser.add_argument("--plan", type=Path, default=ROOT / ".runtime/media-link-plan.json")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--allow-remote-write", action="store_true")
    args = parser.parse_args()
    if not args.plan.resolve().is_relative_to(ROOT / ".runtime"):
        parser.error("Recovery plans must stay in gitignored .runtime")
    if not args.apply:
        if not args.snapshot:
            parser.error("Dry-run requires an explicit read-only --snapshot")
        report = build_plan(json.loads(args.snapshot.read_text(encoding="utf-8")), SupabaseStorage())
        args.plan.parent.mkdir(parents=True, exist_ok=True)
        args.plan.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"mutation_performed": False, "matched": len(report["entries"]),
                          "unmatched": len(report["unmatched"])}))
        return
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    raw = os.getenv("MEDIA_REPAIR_DATABASE_URL", "")
    if not raw:
        parser.error("Set dedicated MEDIA_REPAIR_DATABASE_URL; application DATABASE_URL is never used")
    url = make_url(raw)
    if url.get_backend_name() == "postgresql":
        remote = url.host not in {"127.0.0.1", "localhost"}
        if remote and not args.allow_remote_write:
            parser.error("A reviewed remote repair requires --allow-remote-write")
        url = url.set(drivername="postgresql+psycopg")
        if remote:
            url = url.update_query_dict({"sslmode": "require"})
    elif url.get_backend_name() != "sqlite" or not Path(url.database or "").is_file():
        parser.error("Use explicit PostgreSQL or an existing local SQLite restore")
    engine = create_engine(url, hide_parameters=True)
    try:
        count = apply_plan(engine, json.loads(args.plan.read_text(encoding="utf-8")))
        print(json.dumps({"mutation_performed": True, "linked": count}))
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit("Media recovery stopped. No partial database transaction was committed; inspect configuration/plan without logging secrets.")

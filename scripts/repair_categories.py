"""Audit Unicode; dry-run verified name repairs by ID. Never opens a remote/production DB."""

import argparse
import json
import os
import unicodedata
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


# Verified against the original app/seed.py. Never match by name alone.
DEMO_MAPPING = [
    {"id": key, "expected_name": name_vi, "expected_name_vi": None,
     "name": name, "name_vi": name_vi, "evidence": "original-demo-seed-and-reviewed-bilingual-mapping"}
    for key, name, name_vi in (
        ("heritage", "Historical Sites", "Di tích lịch sử"),
        ("architecture", "Architecture", "Kiến trúc"),
        ("culture", "Culture & Lifestyle", "Văn hóa & đời sống"),
        ("nature", "Green Spaces", "Không gian xanh"),
    )
]


def local_database(url):
    return not os.getenv("APP_ENV") == "production" and (
        url.get_backend_name() == "sqlite" and not url.host and not (url.database or "").startswith(("//", "\\\\"))
        or url.get_backend_name() == "postgresql" and url.host in {"127.0.0.1", "localhost"}
    )


def verified_name(value):
    if not isinstance(value, str):
        raise ValueError("Replacement names must be strings")
    if any(unicodedata.category(c) == "Cc" for c in value):
        raise ValueError("Replacement name contains control characters")
    value = unicodedata.normalize("NFC", value.strip())
    if not value or len(value) > 100 or suspicious(value):
        raise ValueError("Replacement name is empty, damaged or too long")
    return value


def suspicious(name):
    reasons = []
    if "?" in name:
        reasons.append("question_mark")
    if "\ufffd" in name:
        reasons.append("replacement_character")
    if any(unicodedata.category(c) == "Cc" for c in name):
        reasons.append("control_character")
    if any(marker in name for marker in ("Ã©", "Ã´", "Ã¡", "Ä‘", "á»", "áº", "â€")):
        reasons.append("possible_mojibake")
    return reasons


def repair(engine, repairs=(), *, apply=False):
    if not local_database(engine.url):
        raise ValueError("Only a local restore/test database is allowed; production and remote databases are refused")
    with engine.begin() as connection:
        bilingual = "name_vi" in {column["name"] for column in inspect(connection).get_columns("categories")}
        statement = "SELECT id,name" + (",name_vi" if bilingual else "") + " FROM categories"
        if apply and engine.dialect.name == "postgresql":
            statement += " FOR UPDATE"
        rows = {row.id: dict(row._mapping) for row in connection.execute(text(statement))}
        changes = []
        for entry in repairs:
            fields = {"id", "expected_name", "name", "evidence"}
            if bilingual:
                fields |= {"expected_name_vi", "name_vi"}
            if set(entry) != fields or not isinstance(entry["evidence"], str) or not entry["evidence"].strip():
                raise ValueError("Each repair needs id, expected_name, verified name and evidence reference")
            if apply and entry["evidence"].startswith("REQUIRES ADMIN REVIEW"):
                raise ValueError("Source evidence still awaits administrator review; no repairs applied")
            previous = rows.get(entry["id"])
            if (previous is None or previous["name"] != entry["expected_name"]
                    or bilingual and previous["name_vi"] != entry["expected_name_vi"]):
                raise ValueError("Category changed or ID not found; no repairs applied")
            name = verified_name(entry["name"])
            if any(c["id"] == entry["id"] for c in changes):
                raise ValueError("Duplicate repair ID")
            changes.append({**entry, "name": name, **({"name_vi": verified_name(entry["name_vi"])} if bilingual else {})})
        final = rows | {entry["id"]: {**rows[entry["id"]], **entry} for entry in changes}
        names = [row["name"] for row in final.values()]
        if len(set(names)) != len(names):
            raise ValueError("Repair would create duplicate category names")
        # Reject swaps too: the existing unique constraint is immediate.
        if any(other["name"] == entry["name"] and other_id != entry["id"]
               for entry in changes for other_id, other in rows.items()):
            raise ValueError("Repair target name conflicts with an existing category")
        if apply:
            for entry in changes:
                update = "UPDATE categories SET name=:name"
                if bilingual:
                    update += ", name_vi=:name_vi"
                update += " WHERE id=:id AND name=:expected_name"
                if bilingual:
                    update += " AND (name_vi=:expected_name_vi OR (name_vi IS NULL AND :expected_name_vi IS NULL))"
                changed = connection.execute(text(update), entry)
                if changed.rowcount != 1:
                    raise ValueError("Concurrent edit; transaction rolled back")
        return {"mode": "applied" if apply else "dry-run", "changes": changes,
                "unresolved": [
                    {"id": key, "name": row["name"], **({"name_vi": row["name_vi"]} if bilingual else {}),
                     "reasons": suspicious(row["name"]) + (
                         (suspicious(row["name_vi"]) if row["name_vi"] and row["name_vi"].strip()
                          else ["missing_vietnamese_name"])
                         if bilingual else [])}
                    for key, row in final.items()
                    if suspicious(row["name"]) or bilingual and (
                        not row["name_vi"] or not row["name_vi"].strip() or suspicious(row["name_vi"]))
                ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--repairs", type=Path, help="UTF-8 JSON list of verified repairs")
    source.add_argument("--demo-mapping", action="store_true", help="Exact original demo IDs/names only; requires schema 0010")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    # Deliberately ignore DATABASE_URL and .runtime/local.env.
    url = make_url(os.environ.get("CATEGORY_REPAIR_DATABASE_URL", "sqlite:///.runtime/quan1.db"))
    if not local_database(url):
        parser.error("Only a local restore/test database is allowed; production and remote databases are refused")
    if url.get_backend_name() == "sqlite" and (not url.database or not Path(url.database).is_file()):
        parser.error("Local SQLite file does not exist; no database will be created")
    engine = create_engine(url, hide_parameters=True)
    try:
        repairs = (DEMO_MAPPING if args.demo_mapping else
                   json.loads(args.repairs.read_text(encoding="utf-8-sig")) if args.repairs else [])
        if args.apply and not repairs:
            parser.error("--apply requires a reviewed repairs file")
        print(json.dumps(repair(engine, repairs, apply=args.apply), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

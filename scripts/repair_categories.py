"""Audit Unicode; dry-run verified name repairs by ID. Never opens a remote/production DB."""

import argparse
import json
import os
import unicodedata
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def suspicious(name):
    reasons = []
    if "?" in name:
        reasons.append("question_mark")
    if "\ufffd" in name:
        reasons.append("replacement_character")
    if any(marker in name for marker in ("Ã©", "Ã´", "Ã¡", "Ä‘", "á»", "áº", "â€")):
        reasons.append("possible_mojibake")
    return reasons


def repair(engine, repairs=(), *, apply=False):
    with engine.begin() as connection:
        rows = {row.id: row.name for row in connection.execute(text("SELECT id,name FROM categories"))}
        changes = []
        for entry in repairs:
            if set(entry) != {"id", "expected_name", "name", "evidence"} or not entry["evidence"].strip():
                raise ValueError("Each repair needs id, expected_name, verified name and evidence reference")
            if apply and entry["evidence"].startswith("REQUIRES ADMIN REVIEW"):
                raise ValueError("Source evidence still awaits administrator review; no repairs applied")
            if rows.get(entry["id"]) != entry["expected_name"]:
                raise ValueError("Category changed or ID not found; no repairs applied")
            name = unicodedata.normalize("NFC", entry["name"].strip())
            if not name or len(name) > 100 or suspicious(name):
                raise ValueError("Replacement name is empty, damaged or too long")
            if any(c["id"] == entry["id"] for c in changes):
                raise ValueError("Duplicate repair ID")
            changes.append({**entry, "name": name})
        final = rows | {entry["id"]: entry["name"] for entry in changes}
        if len(set(final.values())) != len(final):
            raise ValueError("Repair would create duplicate category names")
        if apply:
            for entry in changes:
                changed = connection.execute(text("UPDATE categories SET name=:name WHERE id=:id AND name=:expected_name"), entry)
                if changed.rowcount != 1:
                    raise ValueError("Concurrent edit; transaction rolled back")
        return {"mode": "applied" if apply else "dry-run", "changes": changes,
                "unresolved": [{"id": key, "name": name, "reasons": suspicious(name)}
                               for key, name in final.items() if suspicious(name)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repairs", type=Path, help="UTF-8 JSON list of verified repairs")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    # Deliberately ignore DATABASE_URL and .runtime/local.env.
    url = make_url(os.environ.get("CATEGORY_REPAIR_DATABASE_URL", "sqlite:///.runtime/quan1.db"))
    if os.getenv("APP_ENV") == "production" or not (
        url.get_backend_name() == "sqlite" or
        url.get_backend_name() == "postgresql" and url.host in {"127.0.0.1", "localhost"}
    ):
        parser.error("Only a local restore/test database is allowed; production and remote databases are refused")
    if url.get_backend_name() == "sqlite" and (not url.database or not Path(url.database).is_file()):
        parser.error("Local SQLite file does not exist; no database will be created")
    engine = create_engine(url, hide_parameters=True)
    try:
        repairs = json.loads(args.repairs.read_text(encoding="utf-8-sig")) if args.repairs else []
        if args.apply and not repairs:
            parser.error("--apply requires a reviewed repairs file")
        print(json.dumps(repair(engine, repairs, apply=args.apply), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

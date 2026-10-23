"""Shared place identities, checked before AI and reserved transactionally on save."""

import hashlib
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy import delete, select

from .models import Poi, PoiIdentity


def normalized_name(value):
    value = unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
    return " ".join(re.sub(r"[^\w\s]", " ", "".join(
        char for char in value if not unicodedata.combining(char)
    )).split())


def identity_keys(name, source=None):
    source = source or {}
    values = ["name:" + normalized_name(name)] if normalized_name(name) else []
    if source.get("url"):
        # Canonicalize legacy links as well as new requests.
        from .wikipedia import normalize_wikipedia_url

        values.append("url:" + normalize_wikipedia_url(source["url"])[2])
    if source.get("wikidata_id"):
        values.append("wikidata:" + source["wikidata_id"])
    return {hashlib.sha256(value.encode()).hexdigest() for value in values}


def find_duplicates(db, name="", source=None, exclude_id=None):
    keys = identity_keys(name, source)
    # Include legacy duplicates that share a reserved key, even if the reservation
    # belongs to the first row migrated. No existing content is deleted or merged.
    return [
        {"id": poi.id, "name": poi.name, "address": poi.address, "status": poi.status}
        for poi in db.scalars(select(Poi).order_by(Poi.id))
        if poi.id != exclude_id and keys & identity_keys(poi.name, poi.source)
    ]


def ensure_unique(db, name, source=None, exclude_id=None):
    matches = find_duplicates(db, name, source, exclude_id)
    if matches:
        raise HTTPException(409, f"Địa điểm đã tồn tại: {matches[0]['name']}. Mở địa điểm hiện có để kiểm tra.")


def reserve_identities(db, poi):
    db.execute(delete(PoiIdentity).where(PoiIdentity.poi_id == poi.id))
    for key in sorted(identity_keys(poi.name, poi.source)):
        db.add(PoiIdentity(key=key, poi_id=poi.id))
    # The primary key prevents two concurrent requests creating the same place.
    db.flush()

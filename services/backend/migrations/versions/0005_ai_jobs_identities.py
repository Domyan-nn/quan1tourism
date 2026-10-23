"""Durable local AI jobs and concurrent place identity reservations."""

import hashlib
import re
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    identities = op.create_table(
        "poi_identities",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_poi_identities_poi_id", "poi_identities", ["poi_id"])
    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("requested_by", sa.String(32), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_hash", sa.String(64), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('queued','running','completed','failed')", name="valid_ai_job_status"),
    )
    op.create_index("ix_ai_jobs_requested_by", "ai_jobs", ["requested_by"])
    op.create_index("ix_ai_jobs_status", "ai_jobs", ["status"])
    op.create_table(
        "ai_workers",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("ready", sa.Boolean(), nullable=False),
    )
    pois = sa.table("pois", sa.column("id"), sa.column("name"), sa.column("source", sa.JSON()))
    claimed = set()
    for poi in op.get_bind().execute(sa.select(pois).order_by(pois.c.id)).mappings():
        value = unicodedata.normalize("NFD", poi["name"].casefold().replace("đ", "d"))
        value = " ".join(re.sub(r"[^\w\s]", " ", "".join(
            c for c in value if not unicodedata.combining(c)
        )).split())
        source = poi["source"] or {}
        values = ["name:" + value] if value else []
        values += [prefix + source[key] for prefix, key in (("url:", "url"), ("wikidata:", "wikidata_id"))
                   if source.get(key)]
        for raw in values:
            key = hashlib.sha256(raw.encode()).hexdigest()
            if key not in claimed:
                op.get_bind().execute(identities.insert().values(key=key, poi_id=poi["id"]))
                claimed.add(key)


def downgrade():
    raise RuntimeError("Restore a verified backup to retain AI jobs and place identities safely.")

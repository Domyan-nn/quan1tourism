"""Bilingual category labels; preserve all legacy names, IDs and relationships.

Legacy language cannot be inferred safely. Verified conversions are a separate
opt-in operation through scripts/repair_categories.py on a local restore.
"""

from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("categories", sa.Column("name_vi", sa.String(100), nullable=True))


def downgrade():
    raise RuntimeError("Keep schema 0010 for application rollback; do not discard Vietnamese category names.")

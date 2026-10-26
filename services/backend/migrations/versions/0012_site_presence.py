"""Track recent anonymous website activity independently of visit totals."""

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "site_presence_sessions",
        sa.Column("session_hash", sa.String(64), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_site_presence_sessions_last_seen_at", "site_presence_sessions", ["last_seen_at"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "site_presence_sessions" ENABLE ROW LEVEL SECURITY')


def downgrade():
    raise RuntimeError("Keep schema 0012 for application rollback; preserve visitor statistics.")

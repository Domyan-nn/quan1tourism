"""Persist session-deduplicated website visits and daily totals."""

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "site_visit_sessions",
        sa.Column("session_hash", sa.String(64), primary_key=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "site_visit_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("visit_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.CheckConstraint("visit_count >= 0", name="nonnegative_site_visits"),
    )
    if op.get_bind().dialect.name == "postgresql":
        for table in ("site_visit_sessions", "site_visit_daily"):
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade():
    raise RuntimeError("Keep schema 0011 for application rollback; preserve visit statistics.")

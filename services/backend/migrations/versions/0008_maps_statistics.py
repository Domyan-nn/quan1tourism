"""Add place summaries and atomic, session-deduplicated engagement counters."""

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("pois") as batch:
        batch.add_column(sa.Column("short_description", sa.Text(), server_default="", nullable=False))
        batch.add_column(sa.Column("view_count", sa.BigInteger(), server_default="0", nullable=False))
        batch.add_column(sa.Column("listen_count", sa.BigInteger(), server_default="0", nullable=False))
        batch.create_check_constraint(
            "nonnegative_poi_statistics", "view_count >= 0 AND listen_count >= 0"
        )
    op.create_table(
        "poi_engagements",
        sa.Column("session_hash", sa.String(64), primary_key=True),
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(6), primary_key=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('view','listen')", name="valid_engagement_kind"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "poi_engagements" ENABLE ROW LEVEL SECURITY')


def downgrade():
    raise RuntimeError("Restore a verified backup to remove engagement history.")

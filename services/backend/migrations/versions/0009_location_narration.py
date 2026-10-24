"""Opt-in foreground narration and private translation provenance; preserve existing content."""

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ai_workers", sa.Column("protocol", sa.Integer(), server_default="1", nullable=False))
    with op.batch_alter_table("pois") as batch:
        batch.add_column(sa.Column("trigger_radius_m", sa.Integer(), server_default="100", nullable=False))
        batch.add_column(sa.Column("auto_narration_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.add_column(sa.Column("narration_meta", sa.JSON(), server_default="{}", nullable=False))
        batch.create_check_constraint("valid_trigger_radius", "trigger_radius_m BETWEEN 20 AND 1000")
        batch.create_check_constraint("auto_narration_coordinates",
                                     "NOT auto_narration_enabled OR (latitude IS NOT NULL AND longitude IS NOT NULL)")


def downgrade():
    raise RuntimeError("Keep schema 0009 for application rollback; restore verified backups into a separate environment.")

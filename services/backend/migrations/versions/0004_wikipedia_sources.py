"""Record Wikipedia provenance and represent unknown coordinates honestly."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("pois") as batch:
        batch.add_column(sa.Column("source", sa.JSON(), nullable=True))
        batch.alter_column("latitude", existing_type=sa.Float(), nullable=True)
        batch.alter_column("longitude", existing_type=sa.Float(), nullable=True)
        batch.create_check_constraint(
            "coordinate_pair",
            "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)",
        )


def downgrade():
    raise RuntimeError("Restore a verified backup to remove Wikipedia source data safely.")

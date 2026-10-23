"""Allow self-registered visitor accounts without granting staff access."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("valid_role", type_="check")
        batch.create_check_constraint("valid_role", "role IN ('visitor','editor','reviewer','admin')")


def downgrade():
    raise RuntimeError("Restore a verified backup to remove visitor accounts safely.")

"""Allow a hashed worker credential to be paired through the administrator API."""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ai_workers", sa.Column("token_hash", sa.String(64), nullable=True))


def downgrade():
    raise RuntimeError("Remove paired worker credentials through the administrator API instead.")

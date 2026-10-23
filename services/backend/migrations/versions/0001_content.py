"""Initial content workflow with private media and immutable release snapshots."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.CheckConstraint("role IN ('editor','reviewer','admin')", name="valid_role"),
    )
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "categories",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
    )
    op.create_table(
        "pois",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("category_id", sa.String(32), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("translations", sa.JSON(), nullable=False),
        sa.Column("image_id", sa.String(32), nullable=True),
        sa.Column("cover", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "status IN ('draft','in_review','approved','published','archived')", name="valid_status"
        ),
        sa.CheckConstraint(
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="valid_coordinates"
        ),
    )
    for field in ("category_id", "status"):
        op.create_index(f"ix_pois_{field}", "pois", [field])
    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("locale", sa.String(5), nullable=True),
        sa.Column("filename", sa.String(120), nullable=False),
        sa.Column("mime", sa.String(60), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("text_hash", sa.String(64), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_media_assets_poi_id", "media_assets", ["poi_id"])
    with op.batch_alter_table("pois") as batch:
        batch.create_foreign_key("fk_poi_image", "media_assets", ["image_id"], ["id"])
    op.create_table(
        "content_releases",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("poi_id", "revision", name="unique_release_revision"),
    )
    for field in ("poi_id", "is_current"):
        op.create_index(f"ix_content_releases_{field}", "content_releases", [field])
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id"), nullable=True),
        sa.Column("actor", sa.String(120), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_poi_id", "audit_logs", ["poi_id"])
    if op.get_bind().dialect.name == "postgresql" and op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis')")
    ):
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        op.execute(
            "ALTER TABLE pois ADD COLUMN location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography) STORED"
        )
        op.execute("CREATE INDEX ix_pois_location ON pois USING GIST(location)")


def downgrade():
    raise RuntimeError(
        "Destructive downgrade disabled. Restore a verified backup to roll back this initial migration."
    )

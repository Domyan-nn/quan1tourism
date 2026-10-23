"""Keep the application's private tables out of Supabase's public Data API."""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        # FastAPI connects with the owner role; browsers never receive a DB key.
        # No anon/authenticated policies: all access goes through API permissions.
        for table in (
            "users", "sessions", "categories", "languages", "pois", "poi_translations",
            "media_assets", "content_releases", "audit_logs", "poi_identities", "ai_jobs", "ai_workers",
            "alembic_version",
        ):
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade():
    raise RuntimeError("Removing database privacy protections requires an explicit access policy review.")

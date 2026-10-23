"""Normalize narration text and introduce an extensible language registry."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

LANGUAGES = [
    ("vi", "Vietnamese", "Tiếng Việt", "vi-VN"),
    ("en", "English", "English", "en-US"),
    ("zh-CN", "Chinese (Simplified)", "简体中文", "zh-CN"),
    ("zh-TW", "Chinese (Traditional)", "繁體中文", "zh-TW"),
    ("ja", "Japanese", "日本語", "ja-JP"),
    ("ko", "Korean", "한국어", "ko-KR"),
    ("fr", "French", "Français", "fr-FR"),
    ("de", "German", "Deutsch", "de-DE"),
    ("es", "Spanish", "Español", "es-ES"),
    ("it", "Italian", "Italiano", "it-IT"),
    ("pt", "Portuguese", "Português", "pt-BR"),
    ("ru", "Russian", "Русский", "ru-RU"),
    ("th", "Thai", "ไทย", "th-TH"),
    ("id", "Indonesian", "Bahasa Indonesia", "id-ID"),
    ("ar", "Arabic", "العربية", "ar-SA"),
]


def upgrade():
    registry = op.create_table(
        "languages",
        sa.Column("code", sa.String(35), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("native_name", sa.String(100), nullable=False),
        sa.Column("speech_locale", sa.String(35), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.CheckConstraint("direction IN ('ltr','rtl')", name="valid_language_direction"),
        sa.CheckConstraint("NOT required OR enabled", name="required_language_enabled"),
        sa.CheckConstraint("code != 'vi' OR (enabled AND required)", name="default_language_enabled"),
    )
    op.bulk_insert(
        registry,
        [
            dict(
                code=code,
                name=name,
                native_name=native,
                speech_locale=speech,
                enabled=True,
                required=code in ("vi", "en"),
                sort_order=index,
                direction="rtl" if code == "ar" else "ltr",
            )
            for index, (code, name, native, speech) in enumerate(LANGUAGES)
        ],
    )
    translations = op.create_table(
        "poi_translations",
        sa.Column("poi_id", sa.String(32), sa.ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("locale", sa.String(35), sa.ForeignKey("languages.code"), primary_key=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.CheckConstraint("length(text) <= 30000", name="narration_text_length"),
    )
    connection = op.get_bind()
    old_pois = sa.table("pois", sa.column("id"), sa.column("translations", sa.JSON()))
    known = {row[0] for row in LANGUAGES}
    for poi_id, values in connection.execute(sa.select(old_pois.c.id, old_pois.c.translations)):
        for locale, value in (values or {}).items():
            if locale not in known:
                connection.execute(
                    registry.insert().values(
                        code=locale,
                        name=locale,
                        native_name=locale,
                        speech_locale=locale,
                        enabled=True,
                        required=False,
                        sort_order=100,
                        direction="ltr",
                    )
                )
                known.add(locale)
            connection.execute(
                translations.insert().values(
                    poi_id=poi_id, locale=locale, title=value.get("title", ""), text=value.get("text", "")
                )
            )
    with op.batch_alter_table("pois") as batch:
        batch.drop_column("translations")
    # Keep historical releases/media intact. New narration never stores audio assets.


def downgrade():
    raise RuntimeError("Restore a verified backup to roll back normalized multilingual content.")

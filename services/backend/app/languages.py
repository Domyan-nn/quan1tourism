"""Language codes are data: adding a language does not require a code deployment."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import Language


def language_data(language):
    return {
        key: getattr(language, key)
        for key in (
            "code",
            "name",
            "native_name",
            "speech_locale",
            "enabled",
            "required",
            "sort_order",
            "direction",
        )
    }


def languages(db, enabled_only=False):
    query = select(Language).order_by(Language.sort_order, Language.code)
    if enabled_only:
        query = query.where(Language.enabled.is_(True))
    return list(db.scalars(query))


def get_language(db, code, enabled_only=False):
    language = db.get(Language, code)
    if not language or (enabled_only and not language.enabled):
        raise HTTPException(422, "Ngôn ngữ chưa được hỗ trợ hoặc đã tắt. Hãy chọn ngôn ngữ khác.")
    return language

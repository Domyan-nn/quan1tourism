import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WikipediaSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=2000)
    title: str = Field(max_length=300)
    revision_id: int | None = None
    retrieved_at: str = Field(max_length=50)
    license: str = Field(default="CC BY-SA", max_length=100)
    model: str = Field(max_length=100)
    warnings: list[str] = Field(default_factory=list, max_length=30)
    wikidata_id: str | None = Field(default=None, pattern=r"^Q\d+$")
    coordinate_source: str | None = Field(default=None, max_length=2000)
    image_url: str | None = Field(default=None, max_length=2000)
    image_page_url: str | None = Field(default=None, max_length=2000)
    image_author: str | None = Field(default=None, max_length=500)
    image_license: str | None = Field(default=None, max_length=100)

    @field_validator("url")
    @classmethod
    def valid_wikipedia(cls, value):
        from .wikipedia import normalize_wikipedia_url

        return normalize_wikipedia_url(value)[2]

    @field_validator("image_url", "image_page_url", "coordinate_source")
    @classmethod
    def valid_source_link(cls, value):
        from urllib.parse import urlsplit

        from .wikipedia import allowed_wikimedia_url

        if value:
            parsed = urlsplit(value)
            if not allowed_wikimedia_url(value):
                raise ValueError("Invalid Wikimedia source URL")
            if parsed.hostname not in {"upload.wikimedia.org", "commons.wikimedia.org", "www.wikidata.org"}:
                if not value.startswith("https://") or "wikipedia.org/wiki/" not in value:
                    raise ValueError("Invalid source URL")
        return value


class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class Register(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=200)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("Name is required")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str):
        value = value.strip().lower()
        if not re.fullmatch(
            r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",
            value,
        ):
            raise ValueError("Invalid email")
        local, _ = value.split("@")
        if len(local) > 64 or local.startswith(".") or local.endswith(".") or ".." in local:
            raise ValueError("Invalid email")
        return value

    @field_validator("password")
    @classmethod
    def nonblank_password(cls, value: str):
        if not value.strip():
            raise ValueError("Password cannot be blank")
        return value


class TranslationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="", max_length=180)
    text: str = Field(default="", max_length=30000)


class PoiInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=180)
    address: str = Field(default="", max_length=300)
    short_description: str = Field(default="", max_length=2000)
    status: Literal["draft", "published", "archived"] | None = None
    category_id: str
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    trigger_radius_m: int = Field(default=100, ge=20, le=1000, strict=True)
    auto_narration_enabled: bool = False
    source: WikipediaSource | None = None
    translations: dict[str, TranslationInput] = Field(default_factory=dict, max_length=100)
    revision: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Both coordinates are required together")
        if self.auto_narration_enabled and self.latitude is None:
            raise ValueError("Automatic narration requires coordinates")
        return self


class WikipediaImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=10, max_length=2000)
    language_codes: list[str] = Field(default_factory=list, max_length=15)


class ActionInput(BaseModel):
    action: Literal["submit", "approve", "reject", "publish", "archive", "restore"]
    revision: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)
    release_id: str | None = None
    confirmed_review: bool = False


class CategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    name_vi: str = Field(min_length=1, max_length=100)
    color: Literal["green", "orange", "purple", "blue"] = "green"

    @field_validator("name", "name_vi", mode="before")
    @classmethod
    def intact_unicode(cls, value):
        import unicodedata

        if not isinstance(value, str):
            return value
        if "\ufffd" in value or "?" in value or any(unicodedata.category(c) == "Cc" for c in value):
            raise ValueError("Category name contains damaged or control characters; enter the verified Unicode name")
        return unicodedata.normalize("NFC", value.strip())


class LanguageInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    code: str = Field(min_length=2, max_length=35, pattern=r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
    name: str = Field(min_length=1, max_length=100)
    native_name: str = Field(min_length=1, max_length=100)
    speech_locale: str = Field(min_length=2, max_length=35, pattern=r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
    enabled: bool = True
    required: bool = False
    sort_order: int = Field(default=100, ge=0, le=10000)
    direction: Literal["ltr", "rtl"] = "ltr"

    @field_validator("code", "speech_locale")
    @classmethod
    def canonical_code(cls, value):
        parts = value.split("-")
        return "-".join(
            [parts[0]]
            + [
                part.title() if len(part) == 4 else part.upper() if len(part) == 2 else part.lower()
                for part in parts[1:]
            ]
        )

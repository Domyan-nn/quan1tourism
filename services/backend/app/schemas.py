import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    name: str = Field(min_length=1, max_length=180)
    address: str = Field(default="", max_length=300)
    category_id: str
    latitude: float = Field(default=10.7769, ge=-90, le=90)
    longitude: float = Field(default=106.7009, ge=-180, le=180)
    translations: dict[str, TranslationInput] = Field(default_factory=dict, max_length=100)
    revision: int = Field(default=1, ge=1)


class ActionInput(BaseModel):
    action: Literal["submit", "approve", "reject", "publish", "archive", "restore"]
    revision: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)
    release_id: str | None = None


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Literal["green", "orange", "purple", "blue"] = "green"


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

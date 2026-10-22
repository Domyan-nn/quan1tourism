from typing import Literal

from pydantic import BaseModel, Field


class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class TranslationInput(BaseModel):
    title: str = Field(default="", max_length=180)
    text: str = Field(default="", max_length=30000)


class PoiInput(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    address: str = Field(default="", max_length=300)
    category_id: str
    latitude: float = Field(default=10.7769, ge=-90, le=90)
    longitude: float = Field(default=106.7009, ge=-180, le=180)
    translations: dict[Literal["vi", "en"], TranslationInput] = Field(default_factory=dict)
    revision: int = Field(default=1, ge=1)


class ActionInput(BaseModel):
    action: Literal["submit", "approve", "reject", "publish", "archive", "restore"]
    revision: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)
    release_id: str | None = None


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Literal["green", "orange", "purple", "blue"] = "green"

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import RUNTIME, database_url

RUNTIME.mkdir(exist_ok=True)
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(RUNTIME / "media")))
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
DATABASE_URL = database_url()
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    **({"connect_args": {"check_same_thread": False}} if DATABASE_URL.startswith("sqlite") else {
        "connect_args": {"connect_timeout": 10, "prepare_threshold": None},
        "pool_size": 3, "max_overflow": 2, "pool_recycle": 300,
    }),
)
if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    with SessionLocal() as session:
        yield session

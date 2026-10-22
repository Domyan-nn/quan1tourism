import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / ".runtime"
RUNTIME.mkdir(exist_ok=True)
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(RUNTIME / "media")))
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(RUNTIME / 'quan1.db').as_posix()}")
engine = create_engine(
    DATABASE_URL,
    **({"connect_args": {"check_same_thread": False}} if DATABASE_URL.startswith("sqlite") else {}),
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

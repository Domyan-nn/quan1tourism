from alembic import context
from app.db import Base, engine
from app import models  # noqa: F401

if context.is_offline_mode():
    context.configure(url=str(engine.url), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine.connect() as connection:
        # SQLite batch migrations rebuild tables referenced by existing sessions.
        # Suspend FK enforcement only on this migration connection, then validate.
        sqlite = connection.dialect.name == "sqlite"
        if sqlite:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            render_as_batch=engine.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()
            if sqlite and connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Migration failed foreign key validation")
        if sqlite:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")

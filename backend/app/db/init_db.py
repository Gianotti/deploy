"""
Smart database initialization.

Fresh DB  → create_all builds every table with the current schema,
            then alembic is stamped at head (no migrations need to run).
Existing DB → alembic upgrade head applies only the pending migrations.
"""
import app.models  # noqa — register all models before create_all
from sqlalchemy import inspect
from alembic.config import Config
from alembic import command

from app.db.base import Base, engine


def init():
    insp = inspect(engine)
    is_fresh = not insp.has_table("alembic_version")

    if is_fresh:
        Base.metadata.create_all(bind=engine)
        cfg = Config("/app/alembic.ini")
        command.stamp(cfg, "head")
        print("✅ DB nueva: tablas creadas + alembic stamped at head.")
    else:
        cfg = Config("/app/alembic.ini")
        command.upgrade(cfg, "head")
        print("✅ DB existente: alembic upgrade head completado.")


if __name__ == "__main__":
    init()

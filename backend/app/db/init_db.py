"""
Smart database initialization — handles three scenarios:

1. Fresh DB (no tables)
   → create_all builds every table, alembic stamped at head.

2. Existing DB, never tracked by alembic (no alembic_version table)
   → Already has base tables from previous create_all calls.
     Stamp at the last migration whose effects are already present,
     then upgrade head to apply only the truly missing ones.

3. Existing DB already tracked by alembic
   → alembic upgrade head applies pending migrations normally.
"""
import app.models  # noqa — register all models before create_all
from sqlalchemy import inspect, text
from alembic.config import Config
from alembic import command

from app.db.base import Base, engine

# Ordered list of all migrations and a column/table each one adds.
# Used to auto-detect the current state of an untracked DB.
_MIGRATION_PROBES = [
    ("001_add_repositories",  "table",  "repositories"),
    ("002_add_teams",         "table",  "teams"),
    ("003_update_team_slots", "column", "team_notification_slots.sort_order"),
    ("004_add_client_logo",   "column", "clients.logo_data"),
]


def _last_applied_revision(insp) -> str | None:
    """Return the latest migration whose effect already exists in the DB."""
    last = None
    for revision, kind, target in _MIGRATION_PROBES:
        if kind == "table":
            if insp.has_table(target):
                last = revision
            else:
                break
        elif kind == "column":
            table, col = target.split(".")
            cols = {c["name"] for c in insp.get_columns(table)}
            if col in cols:
                last = revision
            else:
                break
    return last


def init():
    insp = inspect(engine)
    has_clients  = insp.has_table("clients")
    has_alembic  = insp.has_table("alembic_version")

    cfg = Config("/app/alembic.ini")

    if not has_clients:
        # ── Case 1: truly fresh database ─────────────────────────────────────
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        print("✅ DB nueva: tablas creadas + alembic stamped at head.")

    elif not has_alembic:
        # ── Case 2: existing DB never tracked by alembic ──────────────────────
        last = _last_applied_revision(insp)
        if last:
            command.stamp(cfg, last)
            print(f"✅ DB existente sin rastreo: stamped at {last}.")
        # Now upgrade normally — only the truly missing migrations will run
        command.upgrade(cfg, "head")
        print("✅ Migraciones pendientes aplicadas.")

    else:
        # ── Case 3: alembic already tracking ─────────────────────────────────
        command.upgrade(cfg, "head")
        print("✅ DB existente: alembic upgrade head completado.")


if __name__ == "__main__":
    init()

"""
Smart database initialization — three scenarios:

1. Fresh DB (no 'clients' table)
   → create_all + alembic stamp head.

2. Existing DB, never tracked by alembic (no 'alembic_version' table)
   → create_all for any missing tables (no-op on existing ones)
   → _patch_missing_columns() for ALTER TABLE additions create_all can't do
   → alembic stamp head.

3. Existing DB already tracked by alembic
   → alembic upgrade head (only pending migrations run).
"""
import app.models  # noqa — register all models before create_all
from sqlalchemy import inspect, text
from alembic.config import Config
from alembic import command

from app.db.base import Base, engine


def _patch_missing_columns() -> None:
    """
    Directly apply column additions that create_all cannot handle on
    existing tables. Safe to run multiple times (checks before altering).
    Extend this list whenever a migration adds columns to existing tables.
    """
    insp = inspect(engine)

    with engine.begin() as conn:
        clients_cols = {c["name"] for c in insp.get_columns("clients")}

        if "ga4_property_id" not in clients_cols:
            conn.execute(text("ALTER TABLE clients ADD COLUMN ga4_property_id VARCHAR"))
            print("  → clients.ga4_property_id added")

        if "logo_data" not in clients_cols:
            conn.execute(text("ALTER TABLE clients ADD COLUMN logo_data BYTEA"))
            print("  → clients.logo_data added")

        if "logo_filename" not in clients_cols:
            conn.execute(text("ALTER TABLE clients ADD COLUMN logo_filename VARCHAR"))
            print("  → clients.logo_filename added")

    # Re-inspect after possible changes above
    insp = inspect(engine)
    if insp.has_table("team_notification_slots"):
        with engine.begin() as conn:
            slot_cols = {c["name"] for c in insp.get_columns("team_notification_slots")}

            for col, ddl in [
                ("sort_order",     "ALTER TABLE team_notification_slots ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"),
                ("message_ok",     "ALTER TABLE team_notification_slots ADD COLUMN message_ok TEXT"),
                ("message_blocked","ALTER TABLE team_notification_slots ADD COLUMN message_blocked TEXT"),
                ("gif_data",       "ALTER TABLE team_notification_slots ADD COLUMN gif_data BYTEA"),
                ("gif_filename",   "ALTER TABLE team_notification_slots ADD COLUMN gif_filename VARCHAR"),
            ]:
                if col not in slot_cols:
                    conn.execute(text(ddl))
                    print(f"  → team_notification_slots.{col} added")


def init() -> None:
    insp = inspect(engine)
    has_clients = insp.has_table("clients")
    has_alembic = insp.has_table("alembic_version")
    cfg = Config("/app/alembic.ini")

    if not has_clients:
        # ── Case 1: truly fresh database ─────────────────────────────────────
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        print("✅ DB nueva: tablas creadas + alembic stamped at head.")

    elif not has_alembic:
        # ── Case 2: existing DB, never tracked by alembic ─────────────────────
        # create_all handles any missing tables; patch handles missing columns
        Base.metadata.create_all(bind=engine)
        _patch_missing_columns()
        command.stamp(cfg, "head")
        print("✅ DB existente sin rastreo: esquema actualizado + alembic stamped at head.")

    else:
        # ── Case 3: alembic already tracking ─────────────────────────────────
        command.upgrade(cfg, "head")
        print("✅ DB existente: alembic upgrade head completado.")


if __name__ == "__main__":
    init()

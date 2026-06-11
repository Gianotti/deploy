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
from sqlalchemy import text, inspect
from alembic.config import Config
from alembic import command

from app.db.base import Base, engine


def _patch_missing_columns() -> None:
    """
    Directly apply column additions that create_all cannot handle on
    existing tables. Uses information_schema directly (no Inspector cache).
    Safe to run multiple times — checks before each ALTER.
    """
    with engine.begin() as conn:
        def existing_cols(table: str) -> set:
            rows = conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
            ), {"t": table}).fetchall()
            return {r[0] for r in rows}

        def has_table(table: str) -> bool:
            rows = conn.execute(text(
                "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
            ), {"t": table}).fetchall()
            return len(rows) > 0

        clients_cols = existing_cols("clients")
        for col, ddl in [
            ("ga4_property_id", "ALTER TABLE clients ADD COLUMN ga4_property_id VARCHAR"),
            ("logo_data",       "ALTER TABLE clients ADD COLUMN logo_data BYTEA"),
            ("logo_filename",   "ALTER TABLE clients ADD COLUMN logo_filename VARCHAR"),
        ]:
            if col not in clients_cols:
                conn.execute(text(ddl))
                print(f"  → clients.{col} added")

        if has_table("team_notification_slots"):
            slot_cols = existing_cols("team_notification_slots")
            for col, ddl in [
                ("sort_order",      "ALTER TABLE team_notification_slots ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"),
                ("message_ok",      "ALTER TABLE team_notification_slots ADD COLUMN message_ok TEXT"),
                ("message_blocked", "ALTER TABLE team_notification_slots ADD COLUMN message_blocked TEXT"),
                ("gif_data",        "ALTER TABLE team_notification_slots ADD COLUMN gif_data BYTEA"),
                ("gif_filename",    "ALTER TABLE team_notification_slots ADD COLUMN gif_filename VARCHAR"),
            ]:
                if col not in slot_cols:
                    conn.execute(text(ddl))
                    print(f"  → team_notification_slots.{col} added")


def init() -> None:
    with engine.connect() as probe:
        def _has_table(t: str) -> bool:
            rows = probe.execute(text(
                "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
            ), {"t": t}).fetchall()
            return len(rows) > 0

        has_clients = _has_table("clients")
        has_alembic = _has_table("alembic_version")

    cfg = Config("/app/alembic.ini")

    if not has_clients:
        # ── Case 1: truly fresh database ─────────────────────────────────────
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        print("✅ DB nueva: tablas creadas + alembic stamped at head.")

    elif not has_alembic:
        # ── Case 2: existing DB, never tracked by alembic ─────────────────────
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        print("✅ DB existente sin rastreo: alembic stamped at head.")

    else:
        # ── Case 3: alembic already tracking ─────────────────────────────────
        command.upgrade(cfg, "head")
        print("✅ DB existente: alembic upgrade head completado.")

    # Always patch columns that may be missing regardless of alembic state.
    # Safe to run every startup — checks existence before each ALTER.
    _patch_missing_columns()


if __name__ == "__main__":
    init()

"""
Run with: python -m app.db.seed
Idempotent: skips rows that already exist by email / iso_code.
Creates tables, schema patches, users, countries and deploy rules.
No demo clients or promotions are seeded.
"""

import os

from app.db.base import SessionLocal, Base, engine
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.country import Country
from app.models.deploy_rule import DeployRule, DeployStatus
from app.models.promotion import PromoType
import app.models  # noqa


def _apply_migrations(engine):
    from sqlalchemy import text
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'"
        ))
        cols = {r[0] for r in result}
        for col, ddl in [
            ("ga4_property_id", "ALTER TABLE clients ADD COLUMN ga4_property_id VARCHAR"),
            ("logo_data",       "ALTER TABLE clients ADD COLUMN logo_data BYTEA"),
            ("logo_filename",   "ALTER TABLE clients ADD COLUMN logo_filename VARCHAR"),
        ]:
            if col not in cols:
                conn.execute(text(ddl))
        conn.commit()
    # ALTER TYPE must run outside a transaction block
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac:
        result = ac.execute(text("SELECT unnest(enum_range(NULL::userrole))::text")).fetchall()
        if "comercial" not in {r[0] for r in result}:
            ac.execute(text("ALTER TYPE userrole ADD VALUE 'comercial'"))


def seed():
    Base.metadata.create_all(bind=engine)
    _apply_migrations(engine)
    db = SessionLocal()

    # Users
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_email and admin_password:
        if not db.query(User).filter(User.email == admin_email).first():
            db.add(User(
                email=admin_email,
                hashed_password=hash_password(admin_password),
                full_name="Administrador",
                role=UserRole.ADMIN,
            ))
    comercial_email = os.getenv("COMERCIAL_EMAIL")
    comercial_password = os.getenv("COMERCIAL_PASSWORD")
    if comercial_email and comercial_password:
        if not db.query(User).filter(User.email == comercial_email).first():
            db.add(User(
                email=comercial_email,
                hashed_password=hash_password(comercial_password),
                full_name="Comercial",
                role=UserRole.COMERCIAL,
            ))

    # Countries
    for name, iso, tz in [
        ("Argentina", "ARG", "America/Argentina/Buenos_Aires"),
        ("México",    "MEX", "America/Mexico_City"),
        ("Colombia",  "COL", "America/Bogota"),
        ("Chile",     "CHL", "America/Santiago"),
        ("Perú",      "PER", "America/Lima"),
        ("Uruguay",   "URY", "America/Montevideo"),
    ]:
        if not db.query(Country).filter(Country.iso_code == iso).first():
            db.add(Country(name=name, iso_code=iso, timezone=tz))

    # Deploy rules
    if not db.query(DeployRule).first():
        db.add_all([
            DeployRule(
                promo_type=PromoType.PROMO_ESPECIAL,
                min_criticality=1,
                deploy_status=DeployStatus.BLOQUEADO,
                description="Promo especial → deploy bloqueado todo el día",
            ),
            DeployRule(
                promo_type=PromoType.PROMO_NORMAL,
                min_criticality=3,
                deploy_status=DeployStatus.RESTRINGIDO,
                window_start="22:00",
                window_end="06:00",
                description="Promo normal alta criticidad → solo ventana nocturna",
            ),
            DeployRule(
                promo_type=PromoType.PROMO_NORMAL,
                min_criticality=1,
                deploy_status=DeployStatus.RESTRINGIDO,
                window_start="20:00",
                window_end="08:00",
                description="Promo normal → deploy con aviso en ventana ampliada",
            ),
        ])

    db.commit()
    db.close()
    print("✅ Seed completado.")


if __name__ == "__main__":
    seed()

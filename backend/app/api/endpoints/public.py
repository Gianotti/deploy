from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import List

import pytz
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.client import Client
from app.models.country import Country
from app.models.deploy_rule import DeployRule, DeployStatus
from app.models.integration_config import IntegrationConfig
from app.models.promotion import Promotion
from app.models.repository import Repository
from app.rules.engine import _active_promotions_on_date, can_deploy_now, compute_day_status
from app.services import tracker

router = APIRouter(prefix="/public", tags=["public"])


def _linked_client_ids(client_id: int, db) -> list[int]:
    repos = db.query(Repository).filter(
        Repository.clients.any(Client.id == client_id)
    ).all()
    ids = {client_id}
    for repo in repos:
        for c in repo.clients:
            ids.add(c.id)
    return list(ids)

GA4_CREDS_KEY = "ga4_service_account"


class ClientStatusOut(BaseModel):
    client_id: int
    client_name: str
    country_name: str
    country_iso: str
    timezone: str
    deploy_status: DeployStatus
    can_deploy_now: bool
    window_start: str | None
    window_end: str | None
    active_promo_count: int
    has_logo: bool = False
    ga4_active_users: int | None = None
    ga4_by_country: dict[str, int] = {}
    ga4_top_pages: list[dict] = []


class PublicStatusOut(BaseModel):
    generated_at: str
    clients: List[ClientStatusOut]
    ecosystem_total: int = 0
    ecosystem_peak_today: int = 0


def _fetch_ga4_for_client(creds: str, client_id: int, property_id: str) -> tuple[int, dict | None]:
    try:
        from app.services.ga4_service import get_active_users
        return client_id, get_active_users(creds, property_id)
    except Exception:
        return client_id, None


def _fetch_all_ga4(db: Session, clients: list) -> dict[int, dict]:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == GA4_CREDS_KEY).first()
    if not cfg:
        return {}
    targets = [c for c in clients if c.ga4_property_id]
    if not targets:
        return {}
    result: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(targets), 8)) as pool:
        futures = {pool.submit(_fetch_ga4_for_client, cfg.value, c.id, c.ga4_property_id): c.id for c in targets}
        for future in as_completed(futures):
            cid, data = future.result()
            if data is not None:
                result[cid] = data
    return result


@router.get("/status", response_model=PublicStatusOut)
def public_status(db: Session = Depends(get_db)):
    rules = db.query(DeployRule).all()
    clients = db.query(Client).all()
    active_by_client = tracker.all_active()
    ga4_by_client = _fetch_all_ga4(db, clients)

    results: List[ClientStatusOut] = []

    for client in clients:
        country: Country = db.get(Country, client.country_id)
        tz = pytz.timezone(country.timezone)
        today = datetime.now(tz).date()

        linked_ids = _linked_client_ids(client.id, db)
        promotions = (
            db.query(Promotion)
            .filter(
                Promotion.client_id.in_(linked_ids),
                Promotion.start_date <= today,
                Promotion.end_date >= today,
            )
            .all()
        )

        active = _active_promotions_on_date(promotions, today)
        status, ws, we = compute_day_status(today, active, rules)
        can_now = can_deploy_now(status, ws, we, country.timezone)

        ga4_data = ga4_by_client.get(client.id)
        # GA4 preferred; fallback to in-memory GTM tracker
        users = ga4_data["active_users"] if ga4_data else active_by_client.get(client.id)

        results.append(
            ClientStatusOut(
                client_id=client.id,
                client_name=client.name,
                country_name=country.name,
                country_iso=country.iso_code,
                timezone=country.timezone,
                deploy_status=status,
                can_deploy_now=can_now,
                window_start=ws,
                window_end=we,
                active_promo_count=len(active),
                has_logo=client.logo_data is not None,
                ga4_active_users=users,
                ga4_by_country=ga4_data["by_country"] if ga4_data else {},
                ga4_top_pages=ga4_data["top_pages"] if ga4_data else [],
            )
        )

    weight = {"BLOQUEADO": 0, "RESTRINGIDO": 1, "LIBRE": 2}
    results.sort(key=lambda r: weight[r.deploy_status])

    ecosystem_total = sum(r.ga4_active_users for r in results if r.ga4_active_users is not None)
    tracker.update_ecosystem_peak(ecosystem_total)

    now_utc = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    return PublicStatusOut(
        generated_at=now_utc,
        clients=results,
        ecosystem_total=ecosystem_total,
        ecosystem_peak_today=tracker.get_ecosystem_peak(),
    )


@router.get("/team-gif/{slot_id}")
def get_team_gif(slot_id: int, db: Session = Depends(get_db)):
    """Sirve el GIF/imagen de un slot de notificación de equipo (sin autenticación)."""
    from app.models.team import TeamNotificationSlot
    slot = db.get(TeamNotificationSlot, slot_id)
    if not slot or not slot.gif_data:
        raise HTTPException(404, "GIF no encontrado")
    # Detect content type from filename extension
    fname = (slot.gif_filename or "").lower()
    if fname.endswith(".gif"):
        media_type = "image/gif"
    elif fname.endswith(".png"):
        media_type = "image/png"
    elif fname.endswith(".webp"):
        media_type = "image/webp"
    else:
        media_type = "image/jpeg"
    return Response(content=slot.gif_data, media_type=media_type)

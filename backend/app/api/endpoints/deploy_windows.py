from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import pytz

from app.api.deps import get_current_user
from app.db.base import get_db
from app.models.client import Client
from app.models.country import Country
from app.models.deploy_rule import DeployRule
from app.models.promotion import Promotion
from app.models.repository import Repository
from app.rules.engine import compute_windows, can_deploy_now, compute_day_status, _active_promotions_on_date
from app.schemas.deploy_window import DeployWindowResponse, TodayStatusResponse

router = APIRouter(tags=["deploy-windows"])

STATUS_MESSAGES = {
    "LIBRE": "✅ Deploy libre — podés deployar sin restricciones.",
    "RESTRINGIDO": "🟡 Promo Normal activa — podés deployar avisando al equipo, respetando la ventana horaria si está configurada.",
    "BLOQUEADO": "🔴 Promo Especial activa — deploy bloqueado por todo el día.",
}


def _get_client_and_country(client_id: int, db: Session):
    client = db.query(Client).get(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    country = db.query(Country).get(client.country_id)
    if not country:
        raise HTTPException(404, "Country not found for client")
    return client, country


def _linked_client_ids(client_id: int, db: Session) -> list[int]:
    """Returns all client IDs sharing a repository with client_id, including itself."""
    repos = db.query(Repository).filter(
        Repository.clients.any(Client.id == client_id)
    ).all()
    ids = {client_id}
    for repo in repos:
        for c in repo.clients:
            ids.add(c.id)
    return list(ids)


@router.get("/deploy-windows", response_model=DeployWindowResponse)
def get_deploy_windows(
    client_id: int = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if to_date < from_date:
        raise HTTPException(400, "to_date must be >= from_date")
    if (to_date - from_date).days > 365:
        raise HTTPException(400, "Date range cannot exceed 365 days")

    client, country = _get_client_and_country(client_id, db)
    all_ids = _linked_client_ids(client_id, db)

    promotions = (
        db.query(Promotion)
        .filter(
            Promotion.client_id.in_(all_ids),
            Promotion.end_date >= from_date,
            Promotion.start_date <= to_date,
        )
        .all()
    )
    rules = db.query(DeployRule).all()

    windows = compute_windows(client_id, promotions, rules, from_date, to_date)
    return DeployWindowResponse(
        client_id=client_id,
        country_id=country.id,
        windows=windows,
    )


@router.get("/deploy-status/today", response_model=TodayStatusResponse)
def get_today_status(
    client_id: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    client, country = _get_client_and_country(client_id, db)
    all_ids = _linked_client_ids(client_id, db)

    tz = pytz.timezone(country.timezone)
    today = datetime.now(tz).date()

    promotions = (
        db.query(Promotion)
        .filter(
            Promotion.client_id.in_(all_ids),
            Promotion.start_date <= today,
            Promotion.end_date >= today,
        )
        .all()
    )
    rules = db.query(DeployRule).all()

    active = _active_promotions_on_date(promotions, today)
    status, ws, we = compute_day_status(today, active, rules)
    can_now = can_deploy_now(status, ws, we, country.timezone)

    return TodayStatusResponse(
        client_id=client_id,
        date=today,
        deploy_status=status,
        window_start=ws,
        window_end=we,
        can_deploy_now=can_now,
        active_promotions=active,
        message=STATUS_MESSAGES[status.value],
    )

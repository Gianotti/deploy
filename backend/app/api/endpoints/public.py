from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date, timedelta
from typing import List
import calendar as _cal

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query
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


class PublicTeamOut(BaseModel):
    id: int
    name: str
    deploy_days: list[int]


@router.get("/teams", response_model=list[PublicTeamOut])
def public_teams(db: Session = Depends(get_db)):
    from app.models.team import Team
    teams = db.query(Team).all()
    return [PublicTeamOut(id=t.id, name=t.name, deploy_days=t.deploy_days or []) for t in teams]


class PublicPromoInfo(BaseModel):
    description: str | None
    promo_type: str
    criticality: int


class PublicCalDayClient(BaseModel):
    client_id: int
    client_name: str
    deploy_status: str
    window_start: str | None
    window_end: str | None
    active_promo_count: int
    active_promos: list[PublicPromoInfo] = []


class PublicCalDay(BaseModel):
    date: str
    merged_status: str
    active_client_count: int
    total_promo_count: int
    clients: list[PublicCalDayClient]


class PublicCalendarOut(BaseModel):
    year: int
    month: int
    days: list[PublicCalDay]


@router.get("/calendar", response_model=PublicCalendarOut)
def public_calendar(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
):
    from app.rules.engine import compute_windows

    today = date.today()
    y = year if year is not None else today.year
    m = month if month is not None else today.month
    if not (1 <= m <= 12):
        raise HTTPException(400, "month must be 1–12")

    first_day = date(y, m, 1)
    last_day = date(y, m, _cal.monthrange(y, m)[1])

    _WEIGHT = {DeployStatus.LIBRE: 0, DeployStatus.RESTRINGIDO: 1, DeployStatus.BLOQUEADO: 2}

    clients = db.query(Client).all()
    rules = db.query(DeployRule).all()

    day_map: dict[str, dict] = {}
    d = first_day
    while d <= last_day:
        day_map[d.isoformat()] = {"merged_status": DeployStatus.LIBRE, "clients": []}
        d += timedelta(days=1)

    for client in clients:
        repos = db.query(Repository).filter(
            Repository.clients.any(Client.id == client.id)
        ).all()
        all_ids = {client.id}
        for repo in repos:
            for c in repo.clients:
                all_ids.add(c.id)

        promotions = (
            db.query(Promotion)
            .filter(
                Promotion.client_id.in_(list(all_ids)),
                Promotion.end_date >= first_day,
                Promotion.start_date <= last_day,
            )
            .all()
        )

        windows = compute_windows(client.id, promotions, rules, first_day, last_day)

        for w in windows:
            key = w.date.isoformat()
            entry = day_map[key]
            entry["clients"].append(PublicCalDayClient(
                client_id=client.id,
                client_name=client.name,
                deploy_status=w.deploy_status.value,
                window_start=w.window_start,
                window_end=w.window_end,
                active_promo_count=len(w.active_promotions),
                active_promos=[
                    PublicPromoInfo(
                        description=p.description,
                        promo_type=p.promo_type.value,
                        criticality=p.criticality,
                    )
                    for p in w.active_promotions
                    if p.client_id == client.id
                ],
            ))
            if _WEIGHT[w.deploy_status] > _WEIGHT[entry["merged_status"]]:
                entry["merged_status"] = w.deploy_status

    days = sorted([
        PublicCalDay(
            date=k,
            merged_status=v["merged_status"].value,
            active_client_count=sum(1 for c in v["clients"] if c.active_promo_count > 0),
            total_promo_count=sum(c.active_promo_count for c in v["clients"]),
            clients=v["clients"],
        )
        for k, v in day_map.items()
    ], key=lambda x: x.date)

    return PublicCalendarOut(year=y, month=m, days=days)


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
    user_threshold: int | None = None
    traffic_blocked: bool = False
    ga4_active_users: int | None = None
    ga4_top_pages: list[dict] = []
    ga4_traffic_sources: dict[str, int] = {}
    ga4_device_breakdown: dict[str, int] = {}
    ga4_conversions: int = 0


class PublicStatusOut(BaseModel):
    generated_at: str
    clients: List[ClientStatusOut]
    ecosystem_total: int = 0
    ecosystem_peak_today: int = 0
    ecosystem_mobile_pct: float = 0.0
    ecosystem_desktop_pct: float = 0.0
    ecosystem_conversion_rate: float = 0.0


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

        # Traffic spike threshold: block deploy if active users >= configured limit
        traffic_blocked = bool(
            client.user_threshold is not None
            and users is not None
            and users >= client.user_threshold
        )
        if traffic_blocked:
            status = DeployStatus.BLOQUEADO
            can_now = False

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
                user_threshold=client.user_threshold,
                traffic_blocked=traffic_blocked,
                ga4_active_users=users,
                ga4_top_pages=ga4_data["top_pages"] if ga4_data else [],
                ga4_traffic_sources=ga4_data.get("traffic_sources", {}) if ga4_data else {},
                ga4_device_breakdown=ga4_data.get("device_breakdown", {}) if ga4_data else {},
                ga4_conversions=ga4_data.get("conversions", 0) if ga4_data else 0,
            )
        )

    weight = {"BLOQUEADO": 0, "RESTRINGIDO": 1, "LIBRE": 2}
    results.sort(key=lambda r: weight[r.deploy_status])

    ecosystem_total = sum(r.ga4_active_users for r in results if r.ga4_active_users is not None)
    peak_changed = tracker.update_ecosystem_peak(ecosystem_total)

    if peak_changed:
        import json
        peak_val = tracker.get_ecosystem_peak()
        from datetime import timezone as _tz
        today_str = datetime.now(_tz.utc).strftime("%Y-%m-%d")
        payload = json.dumps({"date": today_str, "peak": peak_val})
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == "ecosystem_peak_today").first()
        if cfg:
            cfg.value = payload
        else:
            db.add(IntegrationConfig(key="ecosystem_peak_today", value=payload))
        db.commit()

    eco_mobile = sum(r.ga4_device_breakdown.get("mobile", 0) for r in results)
    eco_tablet = sum(r.ga4_device_breakdown.get("tablet", 0) for r in results)
    eco_desktop = sum(r.ga4_device_breakdown.get("desktop", 0) for r in results)
    eco_device_total = eco_mobile + eco_tablet + eco_desktop
    eco_mobile_pct = round((eco_mobile + eco_tablet) / eco_device_total * 100, 1) if eco_device_total else 0.0
    eco_desktop_pct = round(eco_desktop / eco_device_total * 100, 1) if eco_device_total else 0.0

    eco_conversions = sum(r.ga4_conversions for r in results)
    eco_cr = round(eco_conversions / ecosystem_total * 100, 2) if ecosystem_total else 0.0

    now_utc = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    return PublicStatusOut(
        generated_at=now_utc,
        clients=results,
        ecosystem_total=ecosystem_total,
        ecosystem_peak_today=tracker.get_ecosystem_peak(),
        ecosystem_mobile_pct=eco_mobile_pct,
        ecosystem_desktop_pct=eco_desktop_pct,
        ecosystem_conversion_rate=eco_cr,
    )

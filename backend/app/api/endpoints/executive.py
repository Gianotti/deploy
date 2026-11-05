"""CMO view: business performance across every client, crossed with promotions.

Auth required — this exposes revenue and conversions, unlike /public/*.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import pytz
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.endpoints.ga4 import _friendly_error, _get_creds
from app.db.base import get_db
from app.models.client import Client
from app.models.country import Country
from app.models.promotion import Promotion
from app.services import executive as ex
from app.services import ga4_reports

router = APIRouter(prefix="/executive", tags=["executive"])

WINDOW = 7          # KPI comparison window: last 7 complete days vs. the 7 before
SPARK_DAYS = 28     # days of daily series sent to the UI
UPCOMING_DAYS = 14
WARM_EVERY_MIN = 30  # background refresh; keeps every property younger than CACHE_TTL


def _local_today(tz_name: str | None) -> date:
    try:
        return datetime.now(pytz.timezone(tz_name)).date() if tz_name else datetime.utcnow().date()
    except pytz.UnknownTimeZoneError:
        return datetime.utcnow().date()


def _promo_out(p: Promotion) -> dict:
    return {
        "id": p.id,
        "description": p.description,
        "promo_type": p.promo_type.value,
        "criticality": p.criticality,
        "start_date": p.start_date.isoformat(),
        "end_date": p.end_date.isoformat(),
    }


def _client_block(client: Client, country: Country, promos: list[Promotion], ga: dict | None) -> dict:
    base = {
        "client_id": client.id,
        "client_name": client.name,
        "country_name": country.name if country else "",
        "country_iso": country.iso_code if country else "",
        "has_logo": client.logo_data is not None,
        "ga4_configured": bool(client.ga4_property_id),
        "currency": None,
        "kpis": None,
        "series": [],
        "channels": [],
        "campaigns": [],
        "active_promos": [],
        "promo_results": [],
        "stale": False,
        "error": None,
    }
    tz = (ga or {}).get("time_zone") or (country.timezone if country else None)
    today = _local_today(tz)
    base["active_promos"] = [_promo_out(p) for p in promos if p.start_date <= today <= p.end_date]

    if ga is None:
        return base
    if ga.get("error"):
        base["error"] = _friendly_error(Exception(ga["error"]))
        return base

    end = today - timedelta(days=1)
    series = ex.fill_series(ga["daily"], end, ga4_reports.SERIES_DAYS)
    kpis = ex.client_kpis(series, end, WINDOW)

    busy: set[date] = set()
    for p in promos:
        busy |= ex.promo_dates(p.start_date, p.end_date)

    results = []
    recent = [p for p in promos if p.end_date >= end - timedelta(days=ex.PROMO_LOOKBACK) and p.start_date <= end]
    for p in sorted(recent, key=lambda p: p.start_date, reverse=True)[:8]:
        lift = ex.promo_lift(series, p.start_date, p.end_date, end, busy, kpis["conversion_key"])
        if lift:
            results.append({**_promo_out(p), "ongoing": p.end_date >= today, **lift})

    base.update({
        "currency": ga.get("currency"),
        "kpis": kpis,
        "series": series[-SPARK_DAYS:],
        "channels": ga["channels"],
        "campaigns": ga["campaigns"],
        "promo_results": results,
        "stale": ga.get("stale", False),
        "data_through": end.isoformat(),
    })
    return base


def build_overview(db: Session, max_age: float = ga4_reports.CACHE_TTL) -> dict:
    clients = db.query(Client).order_by(Client.name).all()
    countries = {c.id: c for c in db.query(Country).all()}
    creds = _get_creds(db)

    since = datetime.utcnow().date() - timedelta(days=ga4_reports.SERIES_DAYS + 2)
    promos_by_client: dict[int, list[Promotion]] = {}
    for p in db.query(Promotion).filter(Promotion.end_date >= since).all():
        promos_by_client.setdefault(p.client_id, []).append(p)

    with_ga = [c for c in clients if c.ga4_property_id] if creds else []
    ga_by_client: dict[int, dict] = {}
    if with_ga:
        with ThreadPoolExecutor(max_workers=min(8, len(with_ga))) as pool:
            for cid, data in pool.map(
                lambda c: (c.id, ga4_reports.fetch_property(creds, c.ga4_property_id, max_age)), with_ga
            ):
                ga_by_client[cid] = data

    blocks = [
        _client_block(c, countries.get(c.country_id), promos_by_client.get(c.id, []), ga_by_client.get(c.id))
        for c in clients
    ]

    today = datetime.utcnow().date()
    horizon = today + timedelta(days=UPCOMING_DAYS)
    names = {c.id: c.name for c in clients}
    upcoming = sorted(
        (
            {**_promo_out(p), "client_id": p.client_id, "client_name": names.get(p.client_id, "")}
            for ps in promos_by_client.values() for p in ps
            if p.end_date >= today and p.start_date <= horizon
        ),
        key=lambda p: (p["start_date"], p["client_name"]),
    )

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "window_days": WINDOW,
        "ga4_configured": bool(creds),
        "ecosystem": ex.ecosystem_kpis(blocks),
        "clients": blocks,
        "upcoming": upcoming,
    }


@router.get("/overview")
def overview(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return build_overview(db)


def warm_cache() -> None:
    """Scheduler job: refresh GA4 reports in the background so the page opens instantly."""
    from app.db.base import SessionLocal

    db = SessionLocal()
    try:
        build_overview(db, max_age=WARM_EVERY_MIN * 60 - 60)
    except Exception:  # noqa: BLE001 — best effort; the endpoint fetches on demand anyway
        pass
    finally:
        db.close()

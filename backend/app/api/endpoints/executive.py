"""CMO view: business performance across every client, crossed with promotions.

Auth required — this exposes revenue and conversions, unlike /public/*.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import pytz
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.api.endpoints.ga4 import _friendly_error, _get_creds
from app.db.base import get_db
from app.models.client import Client
from app.models.country import Country
from app.models.deploy_rule import DeployRule
from app.models.integration_config import IntegrationConfig
from app.models.promotion import Promotion
from app.models.repository import Repository
from app.rules.engine import _active_promotions_on_date, compute_day_status
from app.services import cloudflare_service
from app.services import executive as ex
from app.services import ga4_reports

router = APIRouter(prefix="/executive", tags=["executive"])

WINDOW = 7          # KPI comparison window: last 7 complete days vs. the 7 before
SPARK_DAYS = 28     # days of daily series sent to the UI
UPCOMING_DAYS = 14
WARM_EVERY_MIN = 30  # background refresh; keeps every property younger than CACHE_TTL
# Promos old enough to have a full baseline inside the GA4 series get ranked
HISTORY_DAYS = ga4_reports.SERIES_DAYS - ex.BASELINE_LOOKBACK
DIGEST_KEY = "executive_digest"


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


def _calendar_load(promos: list[Promotion], rules: list[DeployRule], today: date) -> dict:
    """Deploy status of every day of the current month (linked-repo promos included)."""
    first = today.replace(day=1)
    status = {}
    for i in range(ex._days_in_month(first.year, first.month)):
        d = first + timedelta(days=i)
        st, _, _ = compute_day_status(d, _active_promotions_on_date(promos, d), rules)
        status[d] = st.value
    return ex.calendar_load(status, today)


def _client_block(
    client: Client,
    country: Country,
    promos: list[Promotion],
    ga: dict | None,
    linked_promos: list[Promotion] | None = None,
    rules: list[DeployRule] | None = None,
    cf: dict | None = None,
) -> dict:
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
        "devices": [],
        "new_vs_returning": [],
        "funnel": None,
        "items": [],
        "active_promos": [],
        "promo_results": [],
        "promo_history": [],
        "promo_ranking": [],
        "mtd": None,
        "calendar": None,
        "cloudflare": None,
        "stale": False,
        "error": None,
    }
    tz = (ga or {}).get("time_zone") or (country.timezone if country else None)
    today = _local_today(tz)
    base["active_promos"] = [_promo_out(p) for p in promos if p.start_date <= today <= p.end_date]
    if rules is not None:
        base["calendar"] = _calendar_load(linked_promos if linked_promos is not None else promos, rules, today)
    if cf:
        base["cloudflare"] = {k: cf.get(k) for k in ("requests", "bot_requests", "bot_share", "window_minutes")}

    if ga is None:
        return base
    if ga.get("error"):
        base["error"] = _friendly_error(Exception(ga["error"]))
        return base

    end = today - timedelta(days=1)
    series = ex.fill_series(ga["daily"], end, ga4_reports.SERIES_DAYS)
    kpis = ex.client_kpis(series, end, WINDOW)
    conv_key = kpis["conversion_key"]

    busy: set[date] = set()
    for p in promos:
        busy |= ex.promo_dates(p.start_date, p.end_date)

    history = []
    measured = [p for p in promos if end - timedelta(days=HISTORY_DAYS) <= p.start_date <= end]
    for p in sorted(measured, key=lambda p: p.start_date, reverse=True):
        lift = ex.promo_lift(series, p.start_date, p.end_date, end, busy, conv_key)
        if lift:
            history.append({**_promo_out(p), "client_name": client.name,
                            "ongoing": p.end_date >= today, **lift})
    recent_from = (end - timedelta(days=ex.PROMO_LOOKBACK)).isoformat()

    base.update({
        "currency": ga.get("currency"),
        "kpis": kpis,
        "series": series[-SPARK_DAYS:],
        "channels": [{**c, "quality": ex.traffic_quality(c, conv_key)} for c in ga.get("channels", [])],
        "campaigns": [{**c, "quality": ex.traffic_quality(c, conv_key)} for c in ga.get("campaigns", [])],
        "devices": ex.segment_rows(ga.get("devices", []), conv_key),
        "new_vs_returning": ex.segment_rows(ga.get("new_vs_returning", []), conv_key),
        "funnel": ex.funnel_steps(ga.get("funnel_events")) if conv_key == "purchases" else None,
        "items": ga.get("items", []),
        "promo_results": [r for r in history if r["end_date"] >= recent_from][:8],
        "promo_history": history[:30],
        "promo_ranking": ex.promo_ranking(history),
        "mtd": ex.month_to_date(series, end),
        "stale": ga.get("stale", False),
        "data_through": end.isoformat(),
    })
    return base


def _fetch_cloudflare(db: Session, clients: list[Client]) -> dict[int, dict]:
    """Current (last 15 min) Cloudflare bot share per client. Best effort."""
    from app.api.endpoints.cloudflare import get_cf_creds

    creds = get_cf_creds(db)
    targets = [c for c in clients if c.site_host]
    if not creds or not targets:
        return {}

    def fetch(c):
        try:
            return c.id, cloudflare_service.get_bot_traffic(creds["account_id"], creds["api_token"], c.site_host)
        except Exception:  # noqa: BLE001
            return c.id, None

    with ThreadPoolExecutor(max_workers=min(len(targets), 8)) as pool:
        return {cid: data for cid, data in pool.map(fetch, targets) if data}


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
    cf_by_client = _fetch_cloudflare(db, clients)

    # Clients sharing a repository share deploy restrictions (same as the rules engine)
    linked: dict[int, set[int]] = {c.id: {c.id} for c in clients}
    for repo in db.query(Repository).all():
        ids = {c.id for c in repo.clients}
        for cid in ids:
            linked.setdefault(cid, {cid}).update(ids)
    rules = db.query(DeployRule).all()

    blocks = [
        _client_block(
            c, countries.get(c.country_id), promos_by_client.get(c.id, []), ga_by_client.get(c.id),
            linked_promos=[p for cid in linked.get(c.id, {c.id}) for p in promos_by_client.get(cid, [])],
            rules=rules,
            cf=cf_by_client.get(c.id),
        )
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

    all_history = [{**r, "client_id": b["client_id"]} for b in blocks for r in b["promo_history"]]
    ranked = sorted((r for r in all_history if r["conversions"]["lift"] is not None),
                    key=lambda r: r["conversions"]["lift"], reverse=True)
    suspicious = sorted(
        ({"client_id": b["client_id"], "client_name": b["client_name"], **c}
         for b in blocks for c in b["campaigns"] if c["quality"]["level"] in ("likely", "possible")),
        key=lambda c: (-c["quality"]["score"], -c["sessions"]),
    )

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "window_days": WINDOW,
        "ga4_configured": bool(creds),
        "ecosystem": ex.ecosystem_kpis(blocks),
        "mtd": ex.ecosystem_mtd(blocks),
        "history_days": HISTORY_DAYS,
        "promo_ranking": ex.promo_ranking(all_history),
        "best_promos": ranked[:5],
        "worst_promos": [r for r in reversed(ranked) if r["conversions"]["lift"] < 0][:5],
        "alerts": ex.alerts(blocks),
        "suspicious_campaigns": suspicious[:10],
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


# ── Weekly digest to Google Chat ──────────────────────────────────────────────

class DigestConfig(BaseModel):
    enabled: bool = False
    webhook_url: str | None = None
    weekday: int = 0              # 0 = Monday … 6 = Sunday
    time: str = "12:00"           # HH:MM UTC
    base_url: str | None = None   # e.g. https://deploy.example.com — adds a link to /executive

    @field_validator("weekday")
    @classmethod
    def _weekday(cls, v: int) -> int:
        if not 0 <= v <= 6:
            raise ValueError("weekday debe estar entre 0 (lunes) y 6 (domingo)")
        return v

    @field_validator("time")
    @classmethod
    def _time(cls, v: str) -> str:
        try:
            h, m = map(int, v.split(":"))
            ok = 0 <= h < 24 and 0 <= m < 60
        except ValueError:
            ok = False
        if not ok:
            raise ValueError("time debe tener formato HH:MM")
        return f"{h:02d}:{m:02d}"


def load_digest_config(db: Session) -> DigestConfig:
    row = db.query(IntegrationConfig).filter(IntegrationConfig.key == DIGEST_KEY).first()
    if not row:
        return DigestConfig()
    try:
        return DigestConfig(**json.loads(row.value))
    except Exception:  # noqa: BLE001 — corrupt row → defaults (disabled)
        return DigestConfig()


def send_digest(db: Session, cfg: DigestConfig) -> bool:
    from app.services.google_chat import send_to_webhook

    if not cfg.webhook_url:
        return False
    return send_to_webhook(cfg.webhook_url, ex.digest_text(build_overview(db), cfg.base_url))


def digest_job() -> None:
    from app.db.base import SessionLocal

    db = SessionLocal()
    try:
        cfg = load_digest_config(db)
        if cfg.enabled:
            send_digest(db, cfg)
    except Exception as e:  # noqa: BLE001
        print(f"[executive digest] {e}")
    finally:
        db.close()


@router.get("/digest/config", response_model=DigestConfig, dependencies=[Depends(require_admin)])
def get_digest_config(db: Session = Depends(get_db)):
    return load_digest_config(db)


@router.post("/digest/config", response_model=DigestConfig, dependencies=[Depends(require_admin)])
def save_digest_config(payload: DigestConfig, db: Session = Depends(get_db)):
    from app.scheduler import rebuild_digest_job

    if payload.enabled and not payload.webhook_url:
        raise HTTPException(400, "Falta el webhook de Google Chat")
    row = db.query(IntegrationConfig).filter(IntegrationConfig.key == DIGEST_KEY).first()
    value = payload.model_dump_json()
    if row:
        row.value = value
    else:
        db.add(IntegrationConfig(key=DIGEST_KEY, value=value))
    db.commit()
    rebuild_digest_job(payload)
    return payload


@router.post("/digest/test", dependencies=[Depends(require_admin)])
def test_digest(db: Session = Depends(get_db)):
    cfg = load_digest_config(db)
    if not cfg.webhook_url:
        raise HTTPException(400, "Configurá primero el webhook de Google Chat")
    if not send_digest(db, cfg):
        raise HTTPException(502, "Google Chat rechazó el mensaje — revisá el webhook")
    return {"sent": True}


@router.get("/digest/preview", dependencies=[Depends(require_admin)])
def preview_digest(db: Session = Depends(get_db)):
    cfg = load_digest_config(db)
    return {"text": ex.digest_text(build_overview(db), cfg.base_url)}

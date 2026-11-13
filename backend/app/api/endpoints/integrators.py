"""Integrators: third parties (e.g. Sincroshop) that call our sites from known IPs.
CRUD is admin-only; the traffic monitor is for any logged-in user (never public)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.models.integrator import Integrator, IntegratorIP
from app.schemas.integrator import IntegratorIn, IntegratorOut
from app.services import cloudflare_service
from app.services import integrators as svc

router = APIRouter(prefix="/integrators", tags=["integrators"])


@router.get("/", response_model=list[IntegratorOut])
def list_integrators(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Integrator).order_by(Integrator.name).all()


def _check_ips(db: Session, payload: IntegratorIn, own_id: int | None) -> None:
    ips = [x.ip for x in payload.ips]
    if not ips:
        return
    q = db.query(IntegratorIP).filter(IntegratorIP.ip.in_(ips))
    if own_id is not None:
        q = q.filter(IntegratorIP.integrator_id != own_id)
    clash = q.first()
    if clash:
        raise HTTPException(400, f"La IP {clash.ip} ya pertenece a {clash.integrator.name}")


def _check_name(db: Session, name: str, own_id: int | None) -> None:
    q = db.query(Integrator).filter(Integrator.name.ilike(name))
    if own_id is not None:
        q = q.filter(Integrator.id != own_id)
    if q.first():
        raise HTTPException(400, "Ya existe un integrador con ese nombre")


@router.post("/", response_model=IntegratorOut, dependencies=[Depends(require_admin)])
def create_integrator(payload: IntegratorIn, db: Session = Depends(get_db)):
    _check_name(db, payload.name, None)
    _check_ips(db, payload, None)
    it = Integrator(name=payload.name, notes=payload.notes, active=payload.active,
                    ips=[IntegratorIP(ip=x.ip, label=x.label) for x in payload.ips])
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


@router.put("/{integrator_id}", response_model=IntegratorOut, dependencies=[Depends(require_admin)])
def update_integrator(integrator_id: int, payload: IntegratorIn, db: Session = Depends(get_db)):
    it = db.get(Integrator, integrator_id)
    if not it:
        raise HTTPException(404, "Integrador no encontrado")
    _check_name(db, payload.name, it.id)
    _check_ips(db, payload, it.id)
    it.name, it.notes, it.active = payload.name, payload.notes, payload.active
    # Replace the IP list, keeping rows whose IP didn't change.
    wanted = {x.ip: x.label for x in payload.ips}
    for row in list(it.ips):
        if row.ip not in wanted:
            it.ips.remove(row)
        else:
            row.label = wanted.pop(row.ip)
    db.flush()
    for ip, label in wanted.items():
        it.ips.append(IntegratorIP(ip=ip, label=label))
    db.commit()
    db.refresh(it)
    return it


@router.delete("/{integrator_id}", dependencies=[Depends(require_admin)])
def delete_integrator(integrator_id: int, db: Session = Depends(get_db)):
    it = db.get(Integrator, integrator_id)
    if not it:
        raise HTTPException(404, "Integrador no encontrado")
    db.delete(it)
    db.commit()
    return {"deleted": True}


@router.get("/traffic")
def integrator_traffic(
    minutes: int = Query(60),
    client_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Requests from every active integrator's IPs, per site (Cloudflare), over the last `minutes`."""
    return build_integrator_traffic(db, minutes, client_id)


def build_integrator_traffic(db: Session, minutes: int, client_id: int | None, public: bool = False) -> dict:
    """Shared by /integrators/traffic and /public/integrators. `public` hides raw error text."""
    from app.api.endpoints.cloudflare import get_cf_creds

    if minutes not in svc.WINDOWS:
        raise HTTPException(400, f"minutes debe ser uno de {list(svc.WINDOWS)}")
    integrators = db.query(Integrator).filter(Integrator.active.is_(True)).order_by(Integrator.name).all()
    its = [{"id": i.id, "name": i.name, "active": i.active, "ips": [{"ip": x.ip, "label": x.label} for x in i.ips]}
           for i in integrators]
    owner = {x["ip"]: i["id"] for i in its for x in i["ips"]}
    base = {"generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "minutes": minutes}
    creds = get_cf_creds(db)
    if not creds:
        return {**base, "configured": False, "integrators": svc.group_by_integrator(its, [], minutes), "errors": []}

    q = db.query(Client).filter(Client.site_host.isnot(None))
    if client_id is not None:
        q = q.filter(Client.id == client_id)
    clients = q.order_by(Client.name).all()
    # Two clients on the same host would double count: keep the first.
    seen_hosts: set[str] = set()
    targets = []
    for c in clients:
        h = cloudflare_service.normalize_host(c.site_host)
        if h and h not in seen_hosts:
            seen_hosts.add(h)
            targets.append((c.id, c.name, h))

    bucket_dim, size = svc.bucket_for(minutes)
    buckets = svc.bucket_keys(datetime.now(timezone.utc), minutes, size)
    ips = sorted(owner)

    def fetch(t):
        cid, name, host = t
        row = {"client_id": cid, "client_name": name, "site_host": host, "by_integrator": {}, "error": None, "stale": False}
        try:
            raw = cloudflare_service.get_integrator_traffic(creds["account_id"], creds["api_token"], host, ips, minutes, bucket_dim)
            if raw:
                row["by_integrator"] = svc.summarize_zone(raw, owner, bucket_dim, buckets)
                row["stale"] = bool(raw.get("stale"))
        except Exception as e:  # noqa: BLE001
            row["error"] = str(e)[:200]
        return row

    rows = []
    if ips and targets:
        with ThreadPoolExecutor(max_workers=max(1, min(len(targets), 8))) as pool:
            rows = list(pool.map(fetch, targets))
    return {
        **base, "configured": True,
        "bucket_minutes": size,
        "stale": any(r["stale"] for r in rows),
        "integrators": svc.group_by_integrator(its, rows, minutes),
        "errors": [{"client_id": r["client_id"], "client_name": r["client_name"],
                    "error": "Cloudflare no respondió" if public else r["error"]} for r in rows if r["error"]],
    }

"""Integrators: third parties (e.g. Sincroshop) that call some clients' APIs from known IPs.
Each integrator is linked to the clients (stores) it works with; traffic is only looked up there.
CRUD is admin-only; the traffic monitor is for any logged-in user (and per client on /landing/[slug])."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.models.integrator import Integrator, IntegratorIP, IntegratorUserAgent
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


def _clients(db: Session, ids: list[int]) -> list[Client]:
    if not ids:
        return []
    found = db.query(Client).filter(Client.id.in_(ids)).all()
    missing = set(ids) - {c.id for c in found}
    if missing:
        raise HTTPException(400, f"Clientes inexistentes: {sorted(missing)}")
    return found


@router.post("/", response_model=IntegratorOut, dependencies=[Depends(require_admin)])
def create_integrator(payload: IntegratorIn, db: Session = Depends(get_db)):
    _check_name(db, payload.name, None)
    _check_ips(db, payload, None)
    it = Integrator(name=payload.name, notes=payload.notes, active=payload.active,
                    consumes="\n".join(payload.consumes) or None,
                    ips=[IntegratorIP(ip=x.ip, label=x.label) for x in payload.ips],
                    user_agents=[IntegratorUserAgent(pattern=x.pattern, label=x.label) for x in payload.user_agents],
                    clients=_clients(db, payload.client_ids))
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
    it.consumes = "\n".join(payload.consumes) or None
    it.clients = _clients(db, payload.client_ids)
    # Replace the IP and User-Agent lists, keeping rows whose value didn't change.
    wanted = {x.ip: x.label for x in payload.ips}
    for row in list(it.ips):
        if row.ip not in wanted:
            it.ips.remove(row)
        else:
            row.label = wanted.pop(row.ip)
    wanted_ua = {x.pattern: x.label for x in payload.user_agents}
    for row in list(it.user_agents):
        if row.pattern not in wanted_ua:
            it.user_agents.remove(row)
        else:
            row.label = wanted_ua.pop(row.pattern)
    db.flush()
    for ip, label in wanted.items():
        it.ips.append(IntegratorIP(ip=ip, label=label))
    for pattern, label in wanted_ua.items():
        it.user_agents.append(IntegratorUserAgent(pattern=pattern, label=label))
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
    """Requests from each active integrator's IPs on the sites of its linked clients (Cloudflare)."""
    return build_integrator_traffic(db, minutes, client_id)


def build_integrator_traffic(db: Session, minutes: int, client_id: int | None, public: bool = False) -> dict:
    """Shared by /integrators/traffic and /public/integrators. With `client_id`, only the
    integrators linked to that client. `public` hides raw error text."""
    from app.api.endpoints.cloudflare import get_cf_creds

    if minutes not in svc.WINDOWS:
        raise HTTPException(400, f"minutes debe ser uno de {list(svc.WINDOWS)}")
    integrators = db.query(Integrator).filter(Integrator.active.is_(True)).order_by(Integrator.name).all()
    its, clients = [], {}
    for i in integrators:
        linked = [c for c in i.clients if client_id is None or c.id == client_id]
        if client_id is not None and not linked:
            continue
        for c in linked:
            clients[c.id] = c
        its.append({"id": i.id, "name": i.name, "active": i.active,
                    "ips": [{"ip": x.ip, "label": x.label} for x in i.ips],
                    "user_agents": [{"pattern": x.pattern, "label": x.label} for x in i.user_agents],
                    "consumes": svc.split_consumes(i.consumes),
                    "client_ids": [c.id for c in linked]})
    base = {"generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "minutes": minutes}
    creds = get_cf_creds(db)
    if not creds:
        return {**base, "configured": False, "integrators": svc.group_by_integrator(its, [], minutes), "errors": []}

    bucket_dim, size = svc.bucket_for(minutes)
    buckets = svc.bucket_keys(datetime.now(timezone.utc), minutes, size)

    def fetch(c: Client) -> dict:
        host = cloudflare_service.normalize_host(c.site_host) if c.site_host else None
        row = {"client_id": c.id, "client_name": c.name, "site_host": host, "by_integrator": {}, "error": None, "stale": False}
        # Only the IPs / User-Agents of the integrators linked to this client.
        mine = [i for i in its if c.id in i["client_ids"]]
        owner = {x["ip"]: i["id"] for i in mine for x in i["ips"]}
        ua_owner = [(x["pattern"], i["id"]) for i in mine for x in i["user_agents"]]
        # Paths each one consumes. Cloudflare only filters by path when every integrator here has
        # some (one with none takes any path); each one's own prefixes are applied locally anyway.
        path_owner = {i["id"]: i["consumes"] for i in mine if i["consumes"]}
        cf_paths = sorted({p for i in mine for p in i["consumes"]}) if mine and all(i["consumes"] for i in mine) else None
        if not host:
            row["error"] = "Sin dominio configurado (Admin → Clientes)"
            return row
        if not owner and not ua_owner:
            return row
        try:
            raw = cloudflare_service.get_integrator_traffic(
                creds["account_id"], creds["api_token"], host, sorted(owner), minutes, bucket_dim,
                user_agents=sorted({p for p, _ in ua_owner}), paths=cf_paths, path_dim=bool(path_owner))
            if raw:
                row["by_integrator"] = svc.summarize_zone(raw, owner, bucket_dim, buckets, ua_owner, path_owner)
                row["stale"] = bool(raw.get("stale"))
            else:
                row["error"] = f"{host} no está en ninguna zona de Cloudflare"
        except Exception as e:  # noqa: BLE001
            row["error"] = "Cloudflare no respondió" if public else str(e)[:200]
        return row

    targets = sorted(clients.values(), key=lambda c: c.name)
    rows = []
    if targets:
        with ThreadPoolExecutor(max_workers=max(1, min(len(targets), 8))) as pool:
            rows = list(pool.map(fetch, targets))
    return {
        **base, "configured": True,
        "bucket_minutes": size,
        "stale": any(r["stale"] for r in rows),
        "integrators": svc.group_by_integrator(its, rows, minutes),
        "errors": [{"client_id": r["client_id"], "client_name": r["client_name"], "error": r["error"]}
                   for r in rows if r["error"]],
    }

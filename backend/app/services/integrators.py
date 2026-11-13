"""Integrator traffic (third parties calling our APIs from known IPs). Pure: no DB, no network.

Cloudflare rows come from cloudflare_service.get_integrator_traffic(); this module turns them
into per-integrator numbers: requests, errors, bytes, which paths they hit, which IPs were seen
and a per-bucket series.
"""
from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta

from app.services.cloudflare_service import MAX_PATH, mask_path

TOP_PATHS = 30
WINDOWS = (15, 60, 360, 1440)          # minutes the monitor offers
_CACHED = {"hit", "stale", "revalidated", "updating"}


def normalize_ip(value: str) -> str:
    """'100.25.27.248 ' -> '100.25.27.248'; IPv6 in compressed form. Raises ValueError.
    Only single addresses: Cloudflare's clientIP filter matches exact IPs, not ranges."""
    v = (value or "").strip()
    if "/" in v:
        raise ValueError(f"{v}: usá IPs sueltas, Cloudflare no filtra por rangos")
    try:
        return str(ipaddress.ip_address(v))
    except ValueError:
        raise ValueError(f"{v or '(vacía)'} no es una IP válida") from None


def bucket_for(minutes: int) -> tuple[str, int]:
    """GraphQL time dimension and its size in minutes for a window."""
    if minutes <= 60:
        return "datetimeMinute", 1
    if minutes <= 360:
        return "datetimeFiveMinutes", 5
    return "datetimeFifteenMinutes", 15


def bucket_keys(now: datetime, minutes: int, size: int) -> list[str]:
    """Every bucket start in the window, formatted like Cloudflare returns them."""
    start = now - timedelta(minutes=minutes)
    start = start.replace(second=0, microsecond=0, minute=start.minute - start.minute % size)
    out = []
    t = start
    while t < now:
        out.append(t.strftime("%Y-%m-%dT%H:%M:00Z"))
        t += timedelta(minutes=size)
    return out


def _empty(iid: int) -> dict:
    return {"integrator_id": iid, "requests": 0, "bytes": 0, "cached": 0, "errors_4xx": 0, "errors_5xx": 0,
            "ips": {}, "paths": {}, "series": {}}


def summarize_zone(z: dict, owner: dict[str, int], bucket_dim: str, buckets: list[str] | None = None) -> dict[int, dict]:
    """Cloudflare aliases `paths` + `series` filtered to integrator IPs -> {integrator_id: summary}.
    `owner` maps a normalized IP to its integrator. Paths are grouped by method + masked path
    (so /products/123 and /products/456 are one row). IPs not in `owner` are ignored."""
    acc: dict[int, dict] = {}
    for g in z.get("paths") or []:
        d = g["dimensions"]
        try:
            iid = owner.get(normalize_ip(d.get("clientIP") or ""))
        except ValueError:
            iid = None
        if iid is None:
            continue
        e = acc.setdefault(iid, _empty(iid))
        n, b = g["count"], (g.get("sum") or {}).get("edgeResponseBytes") or 0
        status = d.get("edgeResponseStatus") or 0
        is_4xx, is_5xx = 400 <= status < 500, status >= 500
        is_cached = d.get("cacheStatus") in _CACHED
        e["requests"] += n
        e["bytes"] += b
        e["cached"] += n if is_cached else 0
        e["errors_4xx"] += n if is_4xx else 0
        e["errors_5xx"] += n if is_5xx else 0
        ip = normalize_ip(d["clientIP"])
        e["ips"][ip] = e["ips"].get(ip, 0) + n
        path = mask_path(d.get("clientRequestPath") or "/")
        path = path if len(path) <= MAX_PATH else path[:MAX_PATH] + "…"
        method = d.get("clientRequestHTTPMethodName") or ""
        p = e["paths"].setdefault((method, path), {"method": method, "path": path, "requests": 0, "bytes": 0,
                                                   "errors_4xx": 0, "errors_5xx": 0, "status": {}})
        p["requests"] += n
        p["bytes"] += b
        p["errors_4xx"] += n if is_4xx else 0
        p["errors_5xx"] += n if is_5xx else 0
        if status:
            p["status"][str(status)] = p["status"].get(str(status), 0) + n

    for g in z.get("series") or []:
        d = g["dimensions"]
        try:
            iid = owner.get(normalize_ip(d.get("clientIP") or ""))
        except ValueError:
            iid = None
        if iid is None:
            continue
        e = acc.setdefault(iid, _empty(iid))
        t = d.get(bucket_dim)
        e["series"][t] = e["series"].get(t, 0) + g["count"]

    out = {}
    for iid, e in acc.items():
        keys = buckets if buckets else sorted(e["series"])
        seen = [t for t in sorted(e["series"]) if e["series"][t]]
        paths = sorted(e["paths"].values(), key=lambda p: -p["requests"])[:TOP_PATHS]
        for p in paths:
            p["status"] = dict(sorted(p["status"].items(), key=lambda kv: -kv[1]))
        out[iid] = {
            "integrator_id": iid, "requests": e["requests"], "bytes": e["bytes"], "cached": e["cached"],
            "errors_4xx": e["errors_4xx"], "errors_5xx": e["errors_5xx"],
            "ips": [{"ip": ip, "requests": n} for ip, n in sorted(e["ips"].items(), key=lambda kv: -kv[1])],
            "paths": paths,
            "series": [{"t": t, "requests": e["series"].get(t, 0)} for t in keys],
            "last_seen": seen[-1] if seen else None,
        }
    return out


def _zero_client() -> dict:
    return {"requests": 0, "bytes": 0, "cached": 0, "errors_4xx": 0, "errors_5xx": 0,
            "ips": [], "paths": [], "series": [], "last_seen": None}


def group_by_integrator(integrators: list[dict], client_rows: list[dict], minutes: int) -> list[dict]:
    """integrators: [{id, name, active, ips: [{ip, label}], client_ids: [id, ...]}] — the clients
    each integrator is linked to; only those count.
    client_rows: [{client_id, client_name, site_host, error, by_integrator: {id: summarize_zone() entry}}].
    -> one entry per integrator with totals and one row per linked client (also the ones with no
    traffic, carrying `error` when the site couldn't be measured), busiest first."""
    rows_by_id = {r["client_id"]: r for r in client_rows}
    out = []
    for it in integrators:
        by_client = []
        for cid in it.get("client_ids", []):
            r = rows_by_id.get(cid)
            if not r:
                continue
            s = (r.get("by_integrator") or {}).get(it["id"]) or _zero_client()
            by_client.append({"client_id": r["client_id"], "client_name": r["client_name"],
                              "site_host": r.get("site_host"), "error": r.get("error"),
                              **{k: v for k, v in s.items() if k != "integrator_id"}})
        by_client.sort(key=lambda c: (-c["requests"], c["client_name"].lower()))
        req = sum(c["requests"] for c in by_client)
        e4 = sum(c["errors_4xx"] for c in by_client)
        e5 = sum(c["errors_5xx"] for c in by_client)
        seen_ips: dict[str, int] = {}
        for c in by_client:
            for x in c["ips"]:
                seen_ips[x["ip"]] = seen_ips.get(x["ip"], 0) + x["requests"]
        last = max((c["last_seen"] for c in by_client if c["last_seen"]), default=None)
        out.append({
            "id": it["id"], "name": it["name"], "active": it.get("active", True),
            "requests": req,
            "requests_per_min": round(req / minutes, 2) if minutes else 0.0,
            "bytes": sum(c["bytes"] for c in by_client),
            "errors_4xx": e4, "errors_5xx": e5,
            "error_rate": round((e4 + e5) / req, 4) if req else 0.0,
            "last_seen": last,
            "ips": [{"ip": x["ip"], "label": x.get("label"), "requests": seen_ips.get(x["ip"], 0)} for x in it.get("ips", [])],
            "clients": by_client,
        })
    out.sort(key=lambda e: (-e["requests"], e["name"].lower()))
    return out

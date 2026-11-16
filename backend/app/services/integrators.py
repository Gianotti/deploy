"""Integrator traffic (third parties calling our APIs). Pure: no DB, no network.

An integrator is recognized by its registered IPs or, when it never shared them, by fragments
of its User-Agent. Cloudflare rows come from cloudflare_service.get_integrator_traffic(); this
module attributes each row to an integrator and turns them into per-integrator numbers:
requests, errors, bytes, which paths they hit, which IPs / User-Agents were seen and a
per-bucket series.
"""
from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timedelta

from app.services.cloudflare_service import MAX_PATH, mask_path

TOP_PATHS = 30
TOP_DETECTED = 10                      # unregistered IPs / raw User-Agents shown per integrator
UA_MIN_LEN = 4
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


def normalize_ua_pattern(value: str) -> str:
    """A User-Agent fragment to look for. Raises ValueError. Matching is "contains" and
    case-sensitive (Cloudflare's `userAgent_like`); `_` matches any single character, `%` is not allowed."""
    v = (value or "").strip()
    if "%" in v:
        raise ValueError(f"{v}: el user-agent no puede tener %")
    if len(v) < UA_MIN_LEN:
        raise ValueError(f"{v or '(vacío)'}: el user-agent necesita al menos {UA_MIN_LEN} caracteres")
    return v


def ua_like(pattern: str) -> str:
    """Cloudflare `userAgent_like` value for "User-Agent contains pattern"."""
    return f"%{pattern}%"


def _ua_regex(pattern: str) -> re.Pattern:
    # Same semantics as SQL LIKE inside %...%: `_` is any one character, the rest is literal.
    return re.compile(".".join(re.escape(part) for part in pattern.split("_")))


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


def normalize_path_prefix(value: str) -> str:
    """'api/v1/products/' -> '/api/v1/products/'. A full URL keeps only its path; query strings are
    dropped. Raises ValueError. Matching is "the request path starts with it" (case-sensitive);
    `*` is a wildcard for any characters ('/api/*/orders'). A trailing one is redundant but kept
    as typed, so the form shows back what was saved."""
    v = (value or "").strip()
    if "://" in v:
        v = v.split("://", 1)[1]
        v = v[v.index("/"):] if "/" in v else "/"
    v = v.split("?", 1)[0].split("#", 1)[0].strip()
    if not v.startswith("/"):
        v = "/" + v
    if "%" in v or any(c.isspace() for c in v):
        raise ValueError(f"{v}: el path no puede tener % ni espacios")
    v = re.sub(r"\*+", "*", v)
    if len(v.rstrip("*")) < 2:
        raise ValueError("“/” o “/*” solo incluiría todo el sitio: para cualquier path dejá la lista vacía")
    return v


_PATHISH = re.compile(r"https?://\S+|/?[A-Za-z][\w.\-]*(?:/[\w.\-:{}]*)+")


def paths_from_text(text: str | None) -> list[str]:
    """Path-like tokens in free text, e.g. notes saying 'Consume BNA: api/v1/authenticate,
    api/v1/products/' -> ['/api/v1/authenticate', '/api/v1/products/']. Tokens without a segment
    of 3+ letters (like 'y/o') are skipped."""
    out: list[str] = []
    for m in _PATHISH.finditer(text or ""):
        tok = m.group(0).rstrip(".,;:)]}'\"")
        try:
            p = normalize_path_prefix(tok)
        except ValueError:
            continue
        if not any(sum(ch.isalpha() for ch in seg) >= 3 for seg in p.split("/")):
            continue
        if p not in out:
            out.append(p)
    return out


def split_consumes(text: str | None) -> list[str]:
    """Integrator.consumes column (one prefix per line) -> list."""
    return [x.strip() for x in (text or "").splitlines() if x.strip()]


def path_like(prefix: str) -> str:
    """Cloudflare `clientRequestPath_like` value for "path starts with prefix"."""
    return prefix.replace("*", "%") + "%"


def path_matcher(prefix: str) -> re.Pattern:
    """Local equivalent of `path_like`: starts with `prefix`, `*` = any characters."""
    return re.compile("^" + ".*".join(re.escape(x) for x in prefix.split("*")))


def make_resolver(owner: dict[str, int], ua_owner: list[tuple[str, int]] | None = None,
                  path_owner: dict[int, list[str]] | None = None):
    """(clientIP, userAgent, path) -> [(integrator_id, matched UA pattern or None), ...]; empty if nobody's.
    A registered IP wins over a User-Agent match (one owner). Among patterns the longest (most
    specific) wins; a pattern shared by several integrators yields all of them, so the request
    counts for each (we can't tell them apart). `path_owner` maps an integrator to the path
    prefixes it consumes: requests to other paths are not its own (no prefixes = any path;
    path None = not known for this row, no check)."""
    regex: dict[str, re.Pattern] = {}
    by_pattern: dict[str, list[int]] = {}
    for p, iid in ua_owner or []:
        regex.setdefault(p, _ua_regex(p))
        if iid not in by_pattern.setdefault(p, []):
            by_pattern[p].append(iid)
    ordered = sorted(by_pattern, key=lambda p: (-len(p), p))
    prefixes = {iid: [path_matcher(x) for x in pre] for iid, pre in (path_owner or {}).items()}

    def consumes(iid: int, path: str | None) -> bool:
        pre = prefixes.get(iid)
        return not pre or path is None or any(x.match(path) for x in pre)

    def resolve(ip: str, ua: str, path: str | None = None) -> list[tuple[int, str | None]]:
        try:
            iid = owner.get(normalize_ip(ip or ""))
        except ValueError:
            iid = None
        if iid is not None and consumes(iid, path):
            return [(iid, None)]
        if not ua:
            return []
        best = None
        hits: list[tuple[int, str]] = []
        for p in ordered:
            if best is not None and len(p) < best:
                break
            if regex[p].search(ua):
                new = [(i, p) for i in by_pattern[p] if consumes(i, path) and all(i != h for h, _ in hits)]
                if new:
                    best = len(p)
                    hits += new
        return hits
    return resolve


def _empty(iid: int) -> dict:
    return {"integrator_id": iid, "requests": 0, "bytes": 0, "cached": 0, "errors_4xx": 0, "errors_5xx": 0, "shared": 0,
            "ips": {}, "agents": {}, "ua_raw": {}, "paths": {}, "series": {}}


def _ranked(m: dict) -> list[tuple[str, int]]:
    return sorted(m.items(), key=lambda kv: -kv[1])


def summarize_zone(z: dict, owner: dict[str, int], bucket_dim: str, buckets: list[str] | None = None,
                   ua_owner: list[tuple[str, int]] | None = None,
                   path_owner: dict[int, list[str]] | None = None) -> dict[int, dict]:
    """Cloudflare aliases `paths` + `series` (filtered to integrator IPs / User-Agents) ->
    {integrator_id: summary}. `owner` maps a normalized IP to its integrator; `ua_owner` lists
    (pattern, integrator_id); `path_owner` the path prefixes each integrator consumes (requests
    to other paths, e.g. scanners hitting /login.php, are not counted). Paths are grouped by
    method + masked path (so /products/123 and /products/456 are one row). Rows matching no
    integrator are ignored. Series rows carry `clientRequestPath` when any prefixes are set."""
    resolve = make_resolver(owner, ua_owner, path_owner)
    acc: dict[int, dict] = {}
    for g in z.get("paths") or []:
        d = g["dimensions"]
        for iid, pattern in (hits := resolve(d.get("clientIP") or "", d.get("userAgent") or "",
                                             d.get("clientRequestPath") or "/")):
            _add_path_row(acc.setdefault(iid, _empty(iid)), g, d, pattern, len(hits) > 1)

    for g in z.get("series") or []:
        d = g["dimensions"]
        for iid, _ in resolve(d.get("clientIP") or "", d.get("userAgent") or "", d.get("clientRequestPath")):
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
            "errors_4xx": e["errors_4xx"], "errors_5xx": e["errors_5xx"], "shared": e["shared"],
            "ips": [{"ip": ip, "requests": n} for ip, n in _ranked(e["ips"])],
            "agents": [{"pattern": k, "requests": n} for k, n in _ranked(e["agents"])],
            "ua_raw": [{"user_agent": k, "requests": n} for k, n in _ranked(e["ua_raw"])[:TOP_DETECTED]],
            "paths": paths,
            "series": [{"t": t, "requests": e["series"].get(t, 0)} for t in keys],
            "last_seen": seen[-1] if seen else None,
        }
    return out


def _add_path_row(e: dict, g: dict, d: dict, pattern: str | None, shared: bool) -> None:
    """Adds one Cloudflare `paths` group to an integrator's accumulator. `shared` = the same
    request was also counted for another integrator with the same User-Agent pattern."""
    n, b = g["count"], (g.get("sum") or {}).get("edgeResponseBytes") or 0
    status = d.get("edgeResponseStatus") or 0
    is_4xx, is_5xx = 400 <= status < 500, status >= 500
    is_cached = d.get("cacheStatus") in _CACHED
    e["shared"] += n if shared else 0
    e["requests"] += n
    e["bytes"] += b
    e["cached"] += n if is_cached else 0
    e["errors_4xx"] += n if is_4xx else 0
    e["errors_5xx"] += n if is_5xx else 0
    try:
        ip = normalize_ip(d.get("clientIP") or "")
        e["ips"][ip] = e["ips"].get(ip, 0) + n
    except ValueError:
        pass
    if pattern:
        e["agents"][pattern] = e["agents"].get(pattern, 0) + n
    ua = d.get("userAgent") or ""
    if ua:
        e["ua_raw"][ua] = e["ua_raw"].get(ua, 0) + n
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


def _zero_client() -> dict:
    return {"requests": 0, "bytes": 0, "cached": 0, "errors_4xx": 0, "errors_5xx": 0, "shared": 0,
            "ips": [], "agents": [], "ua_raw": [], "paths": [], "series": [], "last_seen": None}


def group_by_integrator(integrators: list[dict], client_rows: list[dict], minutes: int) -> list[dict]:
    """integrators: [{id, name, active, ips: [{ip, label}], user_agents: [{pattern, label}],
    client_ids: [id, ...]}] — the clients each integrator is linked to; only those count.
    client_rows: [{client_id, client_name, site_host, error, by_integrator: {id: summarize_zone() entry}}].
    -> one entry per integrator with totals and one row per linked client (also the ones with no
    traffic, carrying `error` when the site couldn't be measured), busiest first."""
    rows_by_id = {r["client_id"]: r for r in client_rows}
    names_by_pattern: dict[str, list[str]] = {}
    for it in integrators:
        for x in it.get("user_agents", []):
            names_by_pattern.setdefault(x["pattern"], []).append(it["name"])
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
                              "hosts": r.get("hosts") or ([r["site_host"]] if r.get("site_host") else []),
                              **{k: v for k, v in s.items() if k != "integrator_id"}})
        by_client.sort(key=lambda c: (-c["requests"], c["client_name"].lower()))
        req = sum(c["requests"] for c in by_client)
        e4 = sum(c["errors_4xx"] for c in by_client)
        e5 = sum(c["errors_5xx"] for c in by_client)
        seen_ips: dict[str, int] = {}
        seen_agents: dict[str, int] = {}
        seen_raw: dict[str, int] = {}
        for c in by_client:
            for x in c["ips"]:
                seen_ips[x["ip"]] = seen_ips.get(x["ip"], 0) + x["requests"]
            for x in c.get("agents", []):
                seen_agents[x["pattern"]] = seen_agents.get(x["pattern"], 0) + x["requests"]
            for x in c.get("ua_raw", []):
                seen_raw[x["user_agent"]] = seen_raw.get(x["user_agent"], 0) + x["requests"]
        registered = {x["ip"] for x in it.get("ips", [])}
        last = max((c["last_seen"] for c in by_client if c["last_seen"]), default=None)
        out.append({
            "id": it["id"], "name": it["name"], "active": it.get("active", True), "consumes": it.get("consumes", []),
            "requests": req,
            "requests_per_min": round(req / minutes, 2) if minutes else 0.0,
            "bytes": sum(c["bytes"] for c in by_client),
            "errors_4xx": e4, "errors_5xx": e5,
            "error_rate": round((e4 + e5) / req, 4) if req else 0.0,
            # Requests also counted for another integrator with the same User-Agent.
            "shared_requests": sum(c.get("shared", 0) for c in by_client),
            "last_seen": last,
            "ips": [{"ip": x["ip"], "label": x.get("label"), "requests": seen_ips.get(x["ip"], 0)} for x in it.get("ips", [])],
            "user_agents": [{"pattern": x["pattern"], "label": x.get("label"), "requests": seen_agents.get(x["pattern"], 0),
                             "shared_with": sorted({n for n in names_by_pattern.get(x["pattern"], []) if n != it["name"]},
                                                   key=str.lower)}
                            for x in it.get("user_agents", [])],
            # IPs it was seen from that aren't registered (matched by User-Agent): candidates to add.
            "detected_ips": [{"ip": ip, "requests": n} for ip, n in _ranked(seen_ips) if ip not in registered][:TOP_DETECTED],
            "ua_seen": [{"user_agent": k, "requests": n} for k, n in _ranked(seen_raw)][:TOP_DETECTED],
            "clients": by_client,
        })
    out.sort(key=lambda e: (-e["requests"], e["name"].lower()))
    return out


TOP_CALLERS = 30


def summarize_callers(rows: list[dict], hosts: str | list[str], owner: dict[str, int],
                      ua_owner: list[tuple[str, int]], names: dict[int, str]) -> dict:
    """Cloudflare `callers` rows (IP + User-Agent + host, for requests to some paths) -> who they
    are: each row says which registered integrators its IP / User-Agent belongs to (ignoring
    paths) and whether it hit a host the monitor looks at (`hosts`: the client's site + its API
    hosts, `www.` included) or another one in the zone (e.g. api.*)."""
    resolve = make_resolver(owner, ua_owner)
    site = {x for h in ([hosts] if isinstance(hosts, str) else hosts) for x in (h, "www." + h)}
    total = on_site = known = 0
    hosts: dict[str, int] = {}
    callers = []
    for g in rows:
        d, n = g.get("dimensions") or {}, g.get("count") or 0
        host = (d.get("clientRequestHTTPHost") or "").lower()
        ids = sorted({i for i, _ in resolve(d.get("clientIP") or "", d.get("userAgent") or "")})
        total += n
        on_site += n if host in site else 0
        known += n if ids else 0
        hosts[host] = hosts.get(host, 0) + n
        callers.append({"ip": d.get("clientIP") or "", "user_agent": d.get("userAgent") or "", "host": host,
                        "same_site": host in site, "requests": n,
                        "integrators": [names.get(i, f"#{i}") for i in ids]})
    return {
        "total": total, "on_site": on_site, "known": known,
        "hosts": [{"host": h, "requests": n, "same_site": h in site} for h, n in _ranked(hosts)],
        "callers": callers[:TOP_CALLERS],
    }

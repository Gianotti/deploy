"""Integración con Cloudflare (GraphQL Analytics API).

Para cada cliente con `site_host` configurado busca la zona de Cloudflare que lo
contiene y trae las IPs con más requests en los últimos minutos, clasificando
las que parecen bots (crawlers de IA, buscadores, scripts HTTP, datacenters).

Solo se devuelven IPs clasificadas como bot/datacenter: las residenciales son
de clientes reales y nunca salen de acá. `public_summary` agrupa esas IPs por
bot para /public/status (la landing las muestra para tener visibilidad).
"""

import json
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

API = "https://api.cloudflare.com/client/v4"
WINDOW_MINUTES = 15
TOP_GROUPS = 50          # grupos (ip+ua+host) que se piden a la API
MAX_IPS = 10             # IPs sospechosas que se devuelven por cliente

_lock = threading.Lock()
_zones_cache: tuple[float, str, list[dict]] | None = None   # (ts, token, zones)
_ZONES_TTL = 3600
_traffic_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_TRAFFIC_TTL = 120
_no_asn_zones: set[str] = set()   # zonas cuyo plan no expone ASN (Free)

# (patrón en el user agent, tipo, etiqueta). Se evalúa en orden.
_UA_RULES: list[tuple[str, str, str]] = [
    ("gptbot", "ai_crawler", "GPTBot (OpenAI)"),
    ("chatgpt-user", "ai_crawler", "ChatGPT-User (OpenAI)"),
    ("oai-searchbot", "ai_crawler", "OAI-SearchBot (OpenAI)"),
    ("perplexity", "ai_crawler", "PerplexityBot"),
    ("claudebot", "ai_crawler", "ClaudeBot (Anthropic)"),
    ("claude-", "ai_crawler", "Claude (Anthropic)"),
    ("anthropic-ai", "ai_crawler", "Anthropic"),
    ("ccbot", "ai_crawler", "CCBot (Common Crawl)"),
    ("bytespider", "ai_crawler", "Bytespider (ByteDance)"),
    ("amazonbot", "ai_crawler", "Amazonbot"),
    ("meta-externalagent", "ai_crawler", "Meta AI"),
    ("google-extended", "ai_crawler", "Google-Extended"),
    ("applebot", "search", "Applebot"),
    ("googlebot", "search", "Googlebot"),
    ("bingbot", "search", "Bingbot"),
    ("yandex", "search", "YandexBot"),
    ("duckduckbot", "search", "DuckDuckBot"),
    ("baiduspider", "search", "Baiduspider"),
    ("facebookexternalhit", "search", "Facebook preview"),
    ("salesforce", "script", "Salesforce"),
    ("headlesschrome", "script", "Chrome headless"),
    ("puppeteer", "script", "Puppeteer"),
    ("playwright", "script", "Playwright"),
    ("python", "script", "Python"),
    ("aiohttp", "script", "Python aiohttp"),
    ("scrapy", "script", "Scrapy"),
    ("curl/", "script", "curl"),
    ("wget", "script", "wget"),
    ("go-http-client", "script", "Go"),
    ("okhttp", "script", "OkHttp"),
    ("java/", "script", "Java"),
    ("apache-httpclient", "script", "Java HttpClient"),
    ("axios", "script", "axios"),
    ("node-fetch", "script", "Node"),
    ("undici", "script", "Node"),
    ("postmanruntime", "script", "Postman"),
]
_GENERIC_BOT = ("bot", "crawler", "spider", "scraper")

# Proveedores cloud: tráfico desde acá casi nunca es un comprador real.
_DATACENTER_ASN = (
    "amazon", "aws", "google cloud", "google llc", "microsoft", "oracle",
    "digitalocean", "ovh", "hetzner", "linode", "akamai", "alibaba",
    "tencent", "salesforce", "contabo", "vultr", "choopa", "scaleway",
    "leaseweb", "m247", "datacamp", "hostinger",
)


def classify(user_agent: str, asn_name: str | None) -> tuple[str, str] | None:
    """Devuelve (kind, label) si la combinación UA/ASN parece un bot, si no None."""
    ua = (user_agent or "").lower()
    if not ua.strip():
        return "script", "Sin user agent"
    for pattern, kind, label in _UA_RULES:
        if pattern in ua:
            return kind, label
    if any(word in ua for word in _GENERIC_BOT):
        return "bot", "Bot declarado"
    asn = (asn_name or "").lower()
    if asn and any(dc in asn for dc in _DATACENTER_ASN):
        return "datacenter", f"Datacenter ({asn_name})"
    return None


def _request(token: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            raise RuntimeError(f"Cloudflare HTTP {e.code}") from e


def verify_token(account_id: str, token: str) -> bool:
    d = _request(token, "GET", f"/accounts/{account_id}/tokens/verify")
    return bool(d.get("success")) and d.get("result", {}).get("status") == "active"


def list_zones(account_id: str, token: str) -> list[dict]:
    global _zones_cache
    with _lock:
        if _zones_cache and _zones_cache[1] == token and time.time() - _zones_cache[0] < _ZONES_TTL:
            return _zones_cache[2]
    zones: list[dict] = []
    page = 1
    while True:
        d = _request(token, "GET", f"/zones?account.id={account_id}&per_page=50&page={page}")
        if not d.get("success"):
            raise RuntimeError(f"Cloudflare: {d.get('errors')}")
        zones += [{"id": z["id"], "name": z["name"], "plan": z["plan"]["name"]} for z in d["result"]]
        info = d.get("result_info") or {}
        if page >= info.get("total_pages", 1):
            break
        page += 1
    with _lock:
        _zones_cache = (time.time(), token, zones)
    return zones


def normalize_host(site: str | None) -> str | None:
    """'https://www.tiendamacro.com.ar/x' → 'tiendamacro.com.ar'."""
    if not site:
        return None
    h = site.strip().lower()
    if "://" in h:
        h = h.split("://", 1)[1]
    h = h.split("/", 1)[0].split(":", 1)[0]
    if h.startswith("www."):
        h = h[4:]
    return h or None


def resolve_zone(host: str, zones: list[dict]) -> dict | None:
    matches = [z for z in zones if host == z["name"] or host.endswith("." + z["name"])]
    return max(matches, key=lambda z: len(z["name"])) if matches else None


# Una sola consulta trae el tráfico, los grupos sospechosos y las métricas de salud
# (todo disponible incluso en plan Free).
_QUERY = """query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,
 $f60:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,$n:uint64!){
 viewer{zones(filter:{zoneTag:$z}){
  total: httpRequestsAdaptiveGroups(limit:1,filter:$f){count avg{originResponseDurationMs}}
  top: httpRequestsAdaptiveGroups(limit:$n,orderBy:[count_DESC],filter:$f){
   count dimensions{clientIP clientCountryName userAgent%s}
  }
  status: httpRequestsAdaptiveGroups(limit:100,filter:$f){count dimensions{edgeResponseStatus}}
  cache: httpRequestsAdaptiveGroups(limit:20,filter:$f){count dimensions{cacheStatus}}
  series: httpRequestsAdaptiveGroups(limit:200,orderBy:[datetimeMinute_ASC],filter:$f60){
   count dimensions{datetimeMinute}
  }
 }}}"""

# Páginas que pidieron las IPs bot (segunda consulta, filtrada por esas IPs)
_PATHS_QUERY = """query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!){
 viewer{zones(filter:{zoneTag:$z}){
  paths: httpRequestsAdaptiveGroups(limit:100,orderBy:[count_DESC],filter:$f){
   count dimensions{clientIP clientRequestPath}
  }
 }}}"""

# Eventos del firewall (WAF, reglas propias, bot fight). No disponible en plan Free.
_FIREWALL_QUERY = """query($z:String!,$f:ZoneFirewallEventsAdaptiveGroupsFilter_InputObject!){
 viewer{zones(filter:{zoneTag:$z}){
  events: firewallEventsAdaptiveGroups(limit:100,orderBy:[count_DESC],filter:$f){
   count dimensions{action source description clientIP clientCountryName userAgent}
  }
 }}}"""

SERIES_MINUTES = 60
PATHS_PER_IP = 3
MAX_PATH = 120          # hay URLs con bucles de encoding (%2525…) de varios KB
_CACHED = {"hit", "stale", "revalidated", "updating"}
_no_fw_zones: set[str] = set()   # zonas cuyo plan no expone eventos de firewall


def _iso(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def _window(now: datetime, minutes: int, host_filter: list[str] | None) -> dict:
    f: dict = {"datetime_geq": _iso(now - timedelta(minutes=minutes)), "datetime_lt": _iso(now)}
    if host_filter:
        f["clientRequestHTTPHost_in"] = host_filter
    return f


def _graphql(token: str, query: str, variables: dict) -> dict:
    return _request(token, "POST", "/graphql", {"query": query, "variables": variables})


def _main_query(token: str, zone_id: str, now: datetime, host_filter: list[str] | None, with_asn: bool) -> dict:
    return _graphql(token, _QUERY % (" clientASNDescription" if with_asn else ""), {
        "z": zone_id,
        "f": _window(now, WINDOW_MINUTES, host_filter),
        "f60": _window(now, SERIES_MINUTES, host_filter),
        "n": TOP_GROUPS,
    })


def _health(z: dict, total: int) -> dict:
    status = {"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0}
    for g in z["status"]:
        code = g["dimensions"]["edgeResponseStatus"] or 0
        bucket = f"{code // 100}xx"
        if bucket in status:
            status[bucket] += g["count"]
    cached = sum(g["count"] for g in z["cache"] if g["dimensions"]["cacheStatus"] in _CACHED)
    origin = (z["total"][0].get("avg") or {}).get("originResponseDurationMs") if z["total"] else None
    return {
        "status": status,
        "error_rate": round(status["5xx"] / total, 4) if total else 0.0,
        "cached_share": round(cached / total, 3) if total else 0.0,
        "origin_ms": round(origin) if origin is not None else None,
    }


def _series(z: dict) -> list[dict]:
    # El primer y el último minuto vienen incompletos: se descartan para no dibujar falsas caídas.
    points = [{"t": g["dimensions"]["datetimeMinute"], "requests": g["count"]} for g in z["series"]]
    return points[1:-1] if len(points) > 2 else points


def _attach_paths(token: str, zone_id: str, now: datetime, host_filter: list[str] | None, ips: list[dict]) -> None:
    if not ips:
        return
    f = _window(now, WINDOW_MINUTES, host_filter)
    f["clientIP_in"] = [ip["ip"] for ip in ips]
    try:
        d = _graphql(token, _PATHS_QUERY, {"z": zone_id, "f": f})
        rows = d["data"]["viewer"]["zones"][0]["paths"] if not d.get("errors") else []
    except Exception:
        rows = []
    by_ip = {ip["ip"]: ip for ip in ips}
    for r in rows:
        ip = by_ip.get(r["dimensions"]["clientIP"])
        if ip is not None and len(ip["paths"]) < PATHS_PER_IP:
            path = r["dimensions"]["clientRequestPath"]
            ip["paths"].append({"path": path if len(path) <= MAX_PATH else path[:MAX_PATH] + "…", "requests": r["count"]})


def _firewall(token: str, zone_id: str, now: datetime, host_filter: list[str] | None, known: dict[str, dict]) -> dict | None:
    """Qué está frenando Cloudflare. Solo se listan IPs que son bots (por UA o ya
    detectadas en el tráfico): los bloqueos a personas reales van agregados."""
    if zone_id in _no_fw_zones:
        return None
    try:
        d = _graphql(token, _FIREWALL_QUERY, {"z": zone_id, "f": _window(now, WINDOW_MINUTES, host_filter)})
    except Exception:
        return None
    if d.get("errors"):
        if "access" in json.dumps(d["errors"]).lower():
            _no_fw_zones.add(zone_id)
        return None

    by_action: dict[str, int] = {}
    ips: dict[tuple[str, str], dict] = {}
    blocked_search: dict[str, int] = {}
    total = 0
    for g in d["data"]["viewer"]["zones"][0]["events"]:
        dim = g["dimensions"]
        total += g["count"]
        by_action[dim["action"]] = by_action.get(dim["action"], 0) + g["count"]
        hit = classify(dim.get("userAgent") or "", None)
        if not hit and dim["clientIP"] in known:
            hit = (known[dim["clientIP"]]["kind"], known[dim["clientIP"]]["label"])
        if not hit:
            continue
        if hit[0] == "search" and dim["action"] not in ("log", "skip", "allow"):
            blocked_search[hit[1]] = blocked_search.get(hit[1], 0) + g["count"]
        key = (dim["clientIP"], dim["action"])
        e = ips.setdefault(key, {
            "ip": dim["clientIP"],
            "country": dim.get("clientCountryName") or "",
            "kind": hit[0],
            "label": hit[1],
            "action": dim["action"],
            "rule": dim.get("description") or dim.get("source") or "",
            "requests": 0,
        })
        e["requests"] += g["count"]
    return {
        "events": total,
        "by_action": dict(sorted(by_action.items(), key=lambda kv: -kv[1])),
        "top_ips": sorted(ips.values(), key=lambda e: -e["requests"])[:MAX_IPS],
        "blocked_search": [{"label": k, "requests": v} for k, v in sorted(blocked_search.items(), key=lambda kv: -kv[1])],
    }


def public_summary(data: dict | None) -> dict | None:
    """Bots agrupados por etiqueta, con sus IPs (solo las clasificadas como bot)."""
    if not data:
        return None
    bots: dict[str, dict] = {}
    for ip in data["top_ips"]:
        b = bots.setdefault(ip["label"], {"label": ip["label"], "kind": ip["kind"], "requests": 0, "ips": 0, "ip_list": [], "paths": {}})
        b["requests"] += ip["requests"]
        b["ips"] += 1
        b["ip_list"].append({k: ip[k] for k in ("ip", "country", "asn", "requests", "paths")})
        for p in ip["paths"]:
            b["paths"][p["path"]] = b["paths"].get(p["path"], 0) + p["requests"]
    for b in bots.values():
        b["paths"] = [{"path": k, "requests": v} for k, v in sorted(b["paths"].items(), key=lambda kv: -kv[1])[:PATHS_PER_IP]]
    return {
        "host": data["host"],
        "window_minutes": data["window_minutes"],
        "requests": data["requests"],
        "bot_requests": data["bot_requests"],
        "bot_share": data["bot_share"],
        "top_bots": sorted(bots.values(), key=lambda b: -b["requests"]),
        "health": data["health"],
        "series": data["series"],
        "firewall": data["firewall"],
    }


def get_bot_traffic(account_id: str, token: str, site_host: str) -> dict | None:
    """Tráfico de un host en Cloudflare: bots, salud y firewall. None si no hay zona."""
    host = normalize_host(site_host)
    if not host:
        return None
    zone = resolve_zone(host, list_zones(account_id, token))
    if not zone:
        return None

    key = (zone["id"], host)
    cached = _traffic_cache.get(key)
    if cached and time.time() - cached[0] < _TRAFFIC_TTL:
        return cached[1]

    # Si el host es el dominio de la zona se mira toda la zona (incluye subdominios);
    # si es un subdominio puntual se filtra por ese host.
    host_filter = None if host == zone["name"] else [host, "www." + host]
    now = datetime.now(timezone.utc).replace(microsecond=0)

    try:
        with_asn = zone["id"] not in _no_asn_zones
        d = _main_query(token, zone["id"], now, host_filter, with_asn)
        if with_asn and d.get("errors") and "clientasn" in json.dumps(d["errors"]).lower():
            _no_asn_zones.add(zone["id"])
            with_asn = False
            d = _main_query(token, zone["id"], now, host_filter, with_asn)
        if d.get("errors") or not d.get("data"):
            raise RuntimeError(f"Cloudflare GraphQL: {d.get('errors')}")

        z = d["data"]["viewer"]["zones"][0]
        total = z["total"][0]["count"] if z["total"] else 0

        by_ip: dict[str, dict] = {}
        bot_requests = 0
        for g in z["top"]:
            dim = g["dimensions"]
            asn_name = dim.get("clientASNDescription")
            hit = classify(dim.get("userAgent", ""), asn_name)
            if not hit:
                continue
            bot_requests += g["count"]
            ip = dim["clientIP"]
            entry = by_ip.setdefault(ip, {
                "ip": ip,
                "country": dim.get("clientCountryName") or "",
                "asn": asn_name,
                "requests": 0,
                "kind": hit[0],
                "label": hit[1],
                "paths": [],
            })
            entry["requests"] += g["count"]

        top_ips = sorted(by_ip.values(), key=lambda e: -e["requests"])[:MAX_IPS]
        _attach_paths(token, zone["id"], now, host_filter, top_ips)

        data = {
            "zone": zone["name"],
            "host": host,
            "window_minutes": WINDOW_MINUTES,
            "requests": total,
            "bot_requests": bot_requests,
            "bot_share": round(bot_requests / total, 3) if total else 0.0,
            "has_asn": with_asn,
            "top_ips": top_ips,
            "health": _health(z, total),
            "series": _series(z),
            "firewall": _firewall(token, zone["id"], now, host_filter, by_ip),
        }
        _traffic_cache[key] = (time.time(), data)
        return data
    except Exception:
        if cached:
            return cached[1]
        raise


# ── Analytics (consumo en vivo y caché) ──────────────────────────────────────
# Lo que /executive muestra en "Analytics de Cloudflare". Sirve también para los
# clientes sin GA4 (p. ej. embebidos en otra app). Respeta el mismo filtro por host.

ANALYTICS_WINDOW = 15
ANALYTICS_TTL = 60
TOP_PATHS = 25
TOP_BREAKDOWN = 10
_analytics_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_no_visits_zones: set[str] = set()   # zonas donde la API no expone sum.visits
_bad_dims: dict[str, set[str]] = {}  # zona -> desgloses que su plan no expone

# Extra breakdowns (alias -> GraphQL dimension), queried separately so a plan that
# lacks one of them never breaks the core numbers.
BREAKDOWNS = {
    "countries": "clientCountryName",
    "devices": "clientDeviceType",
    "browsers": "userAgentBrowser",
    "os": "userAgentOS",
    "content": "edgeResponseContentTypeName",
    "referers": "clientRefererHost",
    "hosts": "clientRequestHTTPHost",
    "methods": "clientRequestHTTPMethodName",
    "protocols": "clientRequestHTTPProtocol",
    "codes": "edgeResponseStatus",
}
STATUS_SERIES = "status_series"   # per-minute response classes over the last hour


def _extras_query(names: list[str]) -> str:
    uses_f60 = STATUS_SERIES in names
    parts = []
    for a in names:
        if a == STATUS_SERIES:
            parts.append(f"{a}: httpRequestsAdaptiveGroups(limit:3000,orderBy:[datetimeMinute_ASC],filter:$f60)"
                         "{count dimensions{datetimeMinute edgeResponseStatus}}")
        else:
            parts.append(f"{a}: httpRequestsAdaptiveGroups(limit:{TOP_BREAKDOWN * 3},orderBy:[count_DESC],filter:$f)"
                         f"{{count sum{{edgeResponseBytes}} dimensions{{{BREAKDOWNS[a]}}}}}")
    decl = "$z:String!" + (",$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!" if len(names) > (1 if uses_f60 else 0) else "")
    decl += ",$f60:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!" if uses_f60 else ""
    return "query(%s){viewer{zones(filter:{zoneTag:$z}){%s}}}" % (decl, " ".join(parts))


def summarize_breakdowns(z: dict, total: int) -> dict:
    """Pure: extra GraphQL aliases -> {breakdowns: {name: [{key, requests, bytes, share}]}, status_series}.
    `share` is relative to the window's total requests; missing aliases are simply absent."""
    out: dict[str, list[dict]] = {}
    for name, dim in BREAKDOWNS.items():
        if name not in z:
            continue
        agg: dict[str, dict] = {}
        for g in z[name] or []:
            k = g["dimensions"].get(dim)
            k = "" if k is None else str(k)
            e = agg.setdefault(k, {"key": k, "requests": 0, "bytes": 0})
            e["requests"] += g["count"]
            e["bytes"] += _bytes(g)
        top = sorted(agg.values(), key=lambda e: -e["requests"])[:TOP_BREAKDOWN if name != "codes" else 15]
        for e in top:
            e["share"] = round(e["requests"] / total, 3) if total else 0.0
        out[name] = top

    series = None
    if STATUS_SERIES in z:
        minutes: dict[str, dict] = {}
        for g in z[STATUS_SERIES] or []:
            t = g["dimensions"]["datetimeMinute"]
            e = minutes.setdefault(t, {"t": t, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0})
            b = f"{(g['dimensions'].get('edgeResponseStatus') or 0) // 100}xx"
            if b in e:
                e[b] += g["count"]
        series = [minutes[k] for k in sorted(minutes)]
        series = series[1:-1] if len(series) > 2 else series
    return {"breakdowns": out, "status_series": series}

_ANALYTICS_QUERY = """query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,
 $f60:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!){
 viewer{zones(filter:{zoneTag:$z}){
  total: httpRequestsAdaptiveGroups(limit:1,filter:$f){count sum{edgeResponseBytes%s} avg{originResponseDurationMs}}
  cache: httpRequestsAdaptiveGroups(limit:30,filter:$f){count sum{edgeResponseBytes} dimensions{cacheStatus}}
  status: httpRequestsAdaptiveGroups(limit:100,filter:$f){count dimensions{edgeResponseStatus}}
  paths: httpRequestsAdaptiveGroups(limit:1000,orderBy:[count_DESC],filter:$f){
   count sum{edgeResponseBytes} dimensions{clientRequestPath cacheStatus edgeResponseStatus}
  }
  series: httpRequestsAdaptiveGroups(limit:2000,orderBy:[datetimeMinute_ASC],filter:$f60){
   count sum{edgeResponseBytes} dimensions{datetimeMinute cacheStatus}
  }
 }}}"""


def _bytes(g: dict) -> int:
    return (g.get("sum") or {}).get("edgeResponseBytes") or 0


def _merge_paths(rows) -> list[dict]:
    """Pure: (path, count, bytes, cached?, status) rows -> top paths with cache share and errors."""
    paths: dict[str, dict] = {}
    for p, count, byts, is_cached, status in rows:
        p = p if len(p) <= MAX_PATH else p[:MAX_PATH] + "…"
        e = paths.setdefault(p, {"path": p, "requests": 0, "cached": 0, "bytes": 0, "errors_4xx": 0, "errors_5xx": 0})
        e["requests"] += count
        e["bytes"] += byts
        if is_cached:
            e["cached"] += count
        if 400 <= status < 500:
            e["errors_4xx"] += count
        elif status >= 500:
            e["errors_5xx"] += count
    top = sorted(paths.values(), key=lambda e: -e["requests"])[:TOP_PATHS]
    for e in top:
        e["cached_share"] = round(e["cached"] / e["requests"], 3) if e["requests"] else 0.0
    return top


_ID_SEGMENT = re.compile(
    r"^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|(?=.*\d)[A-Za-z0-9_\-]{20,})$",
    re.IGNORECASE)


def mask_path(path: str) -> str:
    """Pure: replaces id-like segments (numbers, UUIDs, hashes, tokens) with ':id'."""
    return "/".join(":id" if s and _ID_SEGMENT.match(s) else s for s in path.split("/"))


def summarize_analytics(z: dict, window_minutes: int = ANALYTICS_WINDOW) -> dict:
    """Pure: raw GraphQL zone block -> traffic, cache breakdown, top paths and per-minute series."""
    tot = z["total"][0] if z.get("total") else {}
    total = tot.get("count", 0)
    total_bytes = _bytes(tot)
    visits = (tot.get("sum") or {}).get("visits")

    by_status: dict[str, dict] = {}
    for g in z.get("cache", []):
        k = g["dimensions"]["cacheStatus"] or "unknown"
        e = by_status.setdefault(k, {"status": k, "cached": k in _CACHED, "requests": 0, "bytes": 0})
        e["requests"] += g["count"]
        e["bytes"] += _bytes(g)
    cached_req = sum(e["requests"] for e in by_status.values() if e["cached"])
    cached_bytes = sum(e["bytes"] for e in by_status.values() if e["cached"])

    top_paths = _merge_paths(
        ((g["dimensions"]["clientRequestPath"] or "/", g["count"], _bytes(g),
          g["dimensions"]["cacheStatus"] in _CACHED, g["dimensions"].get("edgeResponseStatus") or 0)
         for g in z.get("paths", [])))

    minutes: dict[str, dict] = {}
    for g in z.get("series", []):
        t = g["dimensions"]["datetimeMinute"]
        e = minutes.setdefault(t, {"t": t, "requests": 0, "cached": 0, "bytes": 0, "cached_bytes": 0})
        e["requests"] += g["count"]
        e["bytes"] += _bytes(g)
        if g["dimensions"]["cacheStatus"] in _CACHED:
            e["cached"] += g["count"]
            e["cached_bytes"] += _bytes(g)
    series = [minutes[k] for k in sorted(minutes)]
    # El primer y el último minuto vienen incompletos: se descartan para no dibujar falsas caídas.
    series = series[1:-1] if len(series) > 2 else series

    return {
        "window_minutes": window_minutes,
        "requests": total,
        "requests_per_min": round(total / window_minutes, 1) if window_minutes else 0.0,
        "bytes": total_bytes,
        "visits": visits,
        "cache": {
            "hit_ratio": round(cached_req / total, 3) if total else 0.0,
            "bytes_ratio": round(cached_bytes / total_bytes, 3) if total_bytes else 0.0,
            "cached_requests": cached_req,
            "cached_bytes": cached_bytes,
            "origin_requests": total - cached_req,
            "by_status": sorted(by_status.values(), key=lambda e: -e["requests"]),
        },
        "health": _health(z, total),
        "top_paths": top_paths,
        "series": series,
    }


def public_analytics(data: dict) -> dict:
    """Pure: the copy of get_analytics() that may go to the public landing.
    Paths keep their shape but id-like segments (numbers, UUIDs, tokens) become ':id'
    and identical masked paths are merged."""
    merged: dict[str, dict] = {}
    for p in data.get("top_paths", []):
        k = mask_path(p["path"])
        e = merged.setdefault(k, {"path": k, "requests": 0, "cached": 0, "bytes": 0, "errors_4xx": 0, "errors_5xx": 0})
        for f in ("requests", "cached", "bytes", "errors_4xx", "errors_5xx"):
            e[f] += p.get(f, 0)
    top = sorted(merged.values(), key=lambda e: -e["requests"])
    for e in top:
        e["cached_share"] = round(e["cached"] / e["requests"], 3) if e["requests"] else 0.0
    return {**data, "top_paths": top}


def ecosystem_analytics(rows: list[dict]) -> dict:
    """Pure: totals across clients. Rows sharing a host are counted once."""
    seen: set[str] = set()
    req = cached = byts = cbytes = err = 0
    visits: int | None = None
    for r in rows:
        if r["host"] in seen:
            continue
        seen.add(r["host"])
        req += r["requests"]
        cached += r["cache"]["cached_requests"]
        byts += r["bytes"]
        cbytes += r["cache"]["cached_bytes"]
        err += r["health"]["status"]["5xx"]
        if r.get("visits") is not None:
            visits = (visits or 0) + r["visits"]
    w = rows[0]["window_minutes"] if rows else ANALYTICS_WINDOW

    # Merged breakdowns and per-minute series, same host dedupe.
    uniq = list({r["host"]: r for r in rows}.values())
    breakdowns: dict[str, list[dict]] = {}
    for name in BREAKDOWNS:
        if name == "hosts":
            continue
        agg: dict[str, dict] = {}
        for r in uniq:
            for e in (r.get("breakdowns") or {}).get(name, []):
                a = agg.setdefault(e["key"], {"key": e["key"], "requests": 0, "bytes": 0})
                a["requests"] += e["requests"]
                a["bytes"] += e["bytes"]
        if agg:
            top = sorted(agg.values(), key=lambda e: -e["requests"])[:TOP_BREAKDOWN if name != "codes" else 15]
            for e in top:
                e["share"] = round(e["requests"] / req, 3) if req else 0.0
            breakdowns[name] = top
    minutes: dict[str, dict] = {}
    for r in uniq:
        for p in r.get("series", []):
            m = minutes.setdefault(p["t"], {"t": p["t"], "requests": 0, "cached": 0, "bytes": 0, "cached_bytes": 0})
            for f in ("requests", "cached", "bytes", "cached_bytes"):
                m[f] += p.get(f, 0)
    # Keep only minutes every site reported, so a site with a shorter series doesn't fake a drop.
    n_sites = sum(1 for r in uniq if r.get("series"))
    counts: dict[str, int] = {}
    for r in uniq:
        for p in r.get("series", []):
            counts[p["t"]] = counts.get(p["t"], 0) + 1
    series = [minutes[t] for t in sorted(minutes) if counts[t] == n_sites]

    return {
        "breakdowns": breakdowns,
        "series": series,
        "sites": len(seen),
        "requests": req,
        "requests_per_min": round(req / w, 1) if w else 0.0,
        "bytes": byts,
        "visits": visits,
        "hit_ratio": round(cached / req, 3) if req else 0.0,
        "bytes_ratio": round(cbytes / byts, 3) if byts else 0.0,
        "origin_requests": req - cached,
        "error_rate": round(err / req, 4) if req else 0.0,
    }


_DIM_UNAVAILABLE = ("unknown field", "cannot query", "not authorized", "does not have access", "not available", "plan")


def _fetch_extras(token: str, zone_id: str, now: datetime, host_filter: list[str] | None) -> dict:
    """Extra breakdowns, never raises. Dimensions the zone's plan rejects are remembered and
    skipped; a transient failure just leaves them out of this refresh."""
    bad = _bad_dims.setdefault(zone_id, set())
    names = [n for n in [*BREAKDOWNS, STATUS_SERIES] if n not in bad]
    if not names:
        return {}
    variables = {"z": zone_id, "f": _window(now, ANALYTICS_WINDOW, host_filter),
                 "f60": _window(now, SERIES_MINUTES, host_filter)}

    def run(ns: list[str]) -> dict:
        v = {k: variables[k] for k in ("z", "f", "f60") if k == "z" or f"${k}:" in _extras_query(ns)}
        return _graphql(token, _extras_query(ns), v)

    try:
        d = run(names)
        if not d.get("errors") and d.get("data"):
            return d["data"]["viewer"]["zones"][0]
    except Exception:  # noqa: BLE001
        return {}
    # Something in the batch failed: try each one alone to find out which.
    out: dict = {}
    for n in names:
        try:
            d = run([n])
        except Exception:  # noqa: BLE001
            return out   # network / rate limit: don't keep hammering, retry next refresh
        if d.get("errors") or not d.get("data"):
            if any(s in json.dumps(d.get("errors")).lower() for s in _DIM_UNAVAILABLE):
                bad.add(n)
                continue
            return out
        out.update(d["data"]["viewer"]["zones"][0])
    return out


_INTEGRATOR_QUERY = """query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!){viewer{zones(filter:{zoneTag:$z}){
  paths: httpRequestsAdaptiveGroups(limit:5000,orderBy:[count_DESC],filter:$f){
   count sum{edgeResponseBytes} dimensions{clientIP userAgent clientRequestPath clientRequestHTTPMethodName edgeResponseStatus cacheStatus}
  }
  series: httpRequestsAdaptiveGroups(limit:5000,orderBy:[%(b)s_ASC],filter:$f){count dimensions{clientIP userAgent%(p)s %(b)s}}
}}}"""
_integrator_cache: dict[tuple, tuple[float, dict]] = {}


def get_integrator_traffic(account_id: str, token: str, site_host: str, ips: list[str],
                           minutes: int, bucket_dim: str, user_agents: list[str] | None = None,
                           paths: list[str] | None = None, path_dim: bool = False) -> dict | None:
    """Raw `paths` + `series` aliases for requests to a host over the last `minutes` that come
    from one of `ips` OR whose User-Agent contains one of `user_agents`, and (when `paths` is
    given) whose path starts with one of them. `path_dim` adds the path to the series rows so
    each integrator's own prefixes can be applied locally. None if the host has no zone. Cached
    (2 min for short windows, 5 min otherwise); the last good answer is returned (marked stale)
    when Cloudflare fails."""
    from app.services.integrators import path_like, ua_like

    host = normalize_host(site_host)
    uas = sorted(set(user_agents or []))
    prefixes = sorted(set(paths or []))
    if not host or not (ips or uas):
        return None
    zone = resolve_zone(host, list_zones(account_id, token))
    if not zone:
        return None
    key = (zone["id"], host, tuple(sorted(ips)), tuple(uas), tuple(prefixes), path_dim, minutes)
    ttl = 120 if minutes <= 60 else 300
    cached = _integrator_cache.get(key)
    if cached and time.time() - cached[0] < ttl:
        return cached[1]
    host_filter = None if host == zone["name"] else [host, "www." + host]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    who = ([{"clientIP_in": list(ips)}] if ips else []) + [{"userAgent_like": ua_like(p)} for p in uas]
    conds = [who[0] if len(who) == 1 else {"OR": who}]
    if prefixes:
        where = [{"clientRequestPath_like": path_like(p)} for p in prefixes]
        conds.append(where[0] if len(where) == 1 else {"OR": where})
    f = {**_window(now, minutes, host_filter), **(conds[0] if len(conds) == 1 else {"AND": conds})}
    query = _INTEGRATOR_QUERY % {"b": bucket_dim, "p": " clientRequestPath" if path_dim else ""}
    try:
        d = _graphql(token, query, {"z": zone["id"], "f": f})
        if d.get("errors") or not d.get("data"):
            raise RuntimeError(f"Cloudflare GraphQL: {d.get('errors')}")
        z = d["data"]["viewer"]["zones"][0]
        data = {"zone": zone["name"], "host": host, "paths": z.get("paths") or [], "series": z.get("series") or []}
        _integrator_cache[key] = (time.time(), data)
        return data
    except Exception:
        if cached:
            return {**cached[1], "stale": True}
        raise


def get_analytics(account_id: str, token: str, site_host: str) -> dict | None:
    """Live traffic and cache of a host (last 15 min + last hour per minute). None if no zone."""
    host = normalize_host(site_host)
    if not host:
        return None
    zone = resolve_zone(host, list_zones(account_id, token))
    if not zone:
        return None

    key = (zone["id"], host)
    cached = _analytics_cache.get(key)
    if cached and time.time() - cached[0] < ANALYTICS_TTL:
        return cached[1]

    host_filter = None if host == zone["name"] else [host, "www." + host]
    now = datetime.now(timezone.utc).replace(microsecond=0)

    def run(with_visits: bool) -> dict:
        return _graphql(token, _ANALYTICS_QUERY % (" visits" if with_visits else ""), {
            "z": zone["id"],
            "f": _window(now, ANALYTICS_WINDOW, host_filter),
            "f60": _window(now, SERIES_MINUTES, host_filter),
        })

    def core() -> dict:
        with_visits = zone["id"] not in _no_visits_zones
        d = run(with_visits)
        if with_visits and d.get("errors") and "visits" in json.dumps(d["errors"]).lower():
            _no_visits_zones.add(zone["id"])
            d = run(False)
        if d.get("errors") or not d.get("data"):
            raise RuntimeError(f"Cloudflare GraphQL: {d.get('errors')}")
        return d["data"]["viewer"]["zones"][0]

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_core = pool.submit(core)
            fut_extra = pool.submit(_fetch_extras, token, zone["id"], now, host_filter)
            z = fut_core.result()
            extra = fut_extra.result()
        summary = summarize_analytics(z)
        data = {"zone": zone["name"], "host": host, **summary, **summarize_breakdowns(extra, summary["requests"])}
        _analytics_cache[key] = (time.time(), data)
        return data
    except Exception:
        if cached:
            return {**cached[1], "stale": True}
        raise

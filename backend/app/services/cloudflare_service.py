"""Integración con Cloudflare (GraphQL Analytics API).

Para cada cliente con `site_host` configurado busca la zona de Cloudflare que lo
contiene y trae las IPs con más requests en los últimos minutos, clasificando
las que parecen bots (crawlers de IA, buscadores, scripts HTTP, datacenters).

Solo se devuelven IPs clasificadas como bot/datacenter: las residenciales son
de clientes reales y nunca salen de acá. `public_summary` agrupa esas IPs por
bot para /public/status (la landing las muestra para tener visibilidad).
"""

import json
import threading
import time
import urllib.error
import urllib.request
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

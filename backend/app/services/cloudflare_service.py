"""Integración con Cloudflare (GraphQL Analytics API).

Para cada cliente con `site_host` configurado busca la zona de Cloudflare que lo
contiene y trae las IPs con más requests en los últimos minutos, clasificando
las que parecen bots (crawlers de IA, buscadores, scripts HTTP, datacenters).

Solo se devuelven IPs clasificadas como bot/datacenter (las residenciales son
de clientes reales). Las IPs solo salen por endpoints autenticados; para
/public/status usar `public_summary`, que agrupa por bot sin IPs.
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


_QUERY = """query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,$n:uint64!){
 viewer{zones(filter:{zoneTag:$z}){
  total: httpRequestsAdaptiveGroups(limit:1,filter:$f){count}
  top: httpRequestsAdaptiveGroups(limit:$n,orderBy:[count_DESC],filter:$f){
   count dimensions{clientIP clientCountryName userAgent%s}
  }
 }}}"""


def _graphql(token: str, zone_id: str, host_filter: list[str] | None, with_asn: bool) -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    f: dict = {
        "datetime_geq": (now - timedelta(minutes=WINDOW_MINUTES)).isoformat().replace("+00:00", "Z"),
        "datetime_lt": now.isoformat().replace("+00:00", "Z"),
    }
    if host_filter:
        f["clientRequestHTTPHost_in"] = host_filter
    query = _QUERY % (" clientASNDescription" if with_asn else "")
    return _request(token, "POST", "/graphql", {
        "query": query,
        "variables": {"z": zone_id, "f": f, "n": TOP_GROUPS},
    })


def public_summary(data: dict | None) -> dict | None:
    """Versión sin IPs para endpoints públicos: bots agrupados por etiqueta."""
    if not data:
        return None
    bots: dict[str, dict] = {}
    for ip in data["top_ips"]:
        b = bots.setdefault(ip["label"], {"label": ip["label"], "kind": ip["kind"], "requests": 0, "ips": 0})
        b["requests"] += ip["requests"]
        b["ips"] += 1
    return {
        "host": data["host"],
        "window_minutes": data["window_minutes"],
        "requests": data["requests"],
        "bot_requests": data["bot_requests"],
        "bot_share": data["bot_share"],
        "top_bots": sorted(bots.values(), key=lambda b: -b["requests"]),
    }


def get_bot_traffic(account_id: str, token: str, site_host: str) -> dict | None:
    """Resumen de tráfico bot en Cloudflare para un host. None si no hay zona."""
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

    try:
        with_asn = zone["id"] not in _no_asn_zones
        d = _graphql(token, zone["id"], host_filter, with_asn)
        if with_asn and d.get("errors") and "clientasn" in json.dumps(d["errors"]).lower():
            _no_asn_zones.add(zone["id"])
            with_asn = False
            d = _graphql(token, zone["id"], host_filter, with_asn)
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
            })
            entry["requests"] += g["count"]

        data = {
            "zone": zone["name"],
            "host": host,
            "window_minutes": WINDOW_MINUTES,
            "requests": total,
            "bot_requests": bot_requests,
            "bot_share": round(bot_requests / total, 3) if total else 0.0,
            "has_asn": with_asn,
            "top_ips": sorted(by_ip.values(), key=lambda e: -e["requests"])[:MAX_IPS],
        }
        _traffic_cache[key] = (time.time(), data)
        return data
    except Exception:
        if cached:
            return cached[1]
        raise

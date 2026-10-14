"""Heuristic bot-traffic detection over GA4 realtime data.

GA4 realtime exposes no IP or user agent, so this can only flag traffic that
*looks* automated. Each signal adds weight; the total maps to a level:
  >= 4 → "likely", >= 2 → "possible", else "none".
When Cloudflare data is available (see cloudflare_service.get_bot_traffic) the
share of requests from crawlers/scripts/datacenters is one more signal.
Pure function, no I/O — see tests/test_bot_detection.py.
"""

MIN_USERS = 30  # below this, ratios are too noisy to mean anything
CF_MIN_REQUESTS = 500  # same idea for Cloudflare requests in the window

# Cities that host the big cloud regions (AWS, GCP, Azure, Salesforce/Heroku).
# Real shoppers from a LatAm bank marketplace rarely show up here in bulk.
DATACENTER_CITIES = {
    "ashburn", "boardman", "council bluffs", "the dalles", "moncks corner",
    "columbus", "san jose", "santa clara", "north charleston", "des moines",
    "quincy", "san antonio", "chicago", "dublin", "frankfurt",
    "frankfurt am main", "amsterdam", "paris", "london", "singapore",
    "tokyo", "sao paulo", "são paulo", "montreal", "toronto", "mumbai",
}

_ALPHA3_TO_ALPHA2 = {
    "ARG": "AR", "MEX": "MX", "COL": "CO", "CHL": "CL", "PER": "PE",
    "URY": "UY", "PRY": "PY", "BOL": "BO", "ECU": "EC", "BRA": "BR",
    "VEN": "VE", "USA": "US", "ESP": "ES",
}


def _alpha2(iso: str | None) -> str | None:
    if not iso:
        return None
    iso = iso.upper()
    return iso if len(iso) == 2 else _ALPHA3_TO_ALPHA2.get(iso)


def _cloudflare_signal(cf: dict | None) -> tuple[int, list[str]]:
    # Search engines (Googlebot, Bingbot) are expected and harmless: not counted.
    if not cf or cf.get("requests", 0) < CF_MIN_REQUESTS:
        return 0, []
    noisy = [ip for ip in cf.get("top_ips", []) if ip["kind"] != "search"]
    search = sum(ip["requests"] for ip in cf.get("top_ips", []) if ip["kind"] == "search")
    share = max(cf.get("bot_requests", 0) - search, 0) / cf["requests"]
    if share < 0.15 or not noisy:
        return 0, []
    by_label: dict[str, int] = {}
    for ip in noisy:
        by_label[ip["label"]] = by_label.get(ip["label"], 0) + ip["requests"]
    top = max(by_label, key=by_label.get)
    reason = f"{round(share * 100)}% de las requests en Cloudflare son bots ({top})"
    return (2 if share >= 0.3 else 1), [reason]


def assess_bot_suspicion(data: dict | None, home_country_iso: str | None, cf: dict | None = None) -> dict:
    """Return {"level": "none"|"possible"|"likely", "score": int, "reasons": [str]}."""
    score, reasons = _cloudflare_signal(cf)
    data = data or {}
    users = data.get("active_users") or 0
    if users < MIN_USERS:
        return _result(score, reasons)

    # 1. Traffic from outside the client's country
    locations = data.get("top_locations") or []
    home = _alpha2(home_country_iso)
    loc_total = sum(l["users"] for l in locations)
    if home and loc_total:
        foreign = sum(l["users"] for l in locations if l["country_id"] and l["country_id"] != home)
        share = foreign / loc_total
        if share >= 0.4:
            score += 2
            reasons.append(f"{round(share * 100)}% del tráfico es de fuera del país")
        elif share >= 0.2:
            score += 1
            reasons.append(f"{round(share * 100)}% del tráfico es de fuera del país")

    # 2. Concentration in cloud datacenter cities
    if loc_total:
        dc = [l for l in locations if l["city"].lower() in DATACENTER_CITIES and l["country_id"] != home]
        dc_users = sum(l["users"] for l in dc)
        if dc_users / loc_total >= 0.15:
            score += 2
            top = max(dc, key=lambda l: l["users"])
            reasons.append(f"{round(dc_users / loc_total * 100)}% desde ciudades de datacenter ({top['city']})")

    # 3. Desktop-heavy traffic (these marketplaces are mostly mobile)
    dev = data.get("device_breakdown") or {}
    dev_total = sum(dev.values())
    if dev_total and dev.get("desktop", 0) / dev_total >= 0.7:
        score += 1
        reasons.append(f"{round(dev['desktop'] / dev_total * 100)}% desktop")

    # 4. Almost no engagement: page loads without interaction
    events = {e["event"]: e["count"] for e in data.get("top_events") or []}
    if "page_view" in events or "session_start" in events:
        engagement = events.get("user_engagement", 0) + events.get("scroll", 0)
        if engagement / users < 0.3:
            score += 1
            reasons.append("casi sin interacción (sin scroll ni engagement)")

    # 5. Practically everyone is a first-time visitor
    nvr = data.get("new_vs_returning") or {}
    nvr_total = nvr.get("new", 0) + nvr.get("returning", 0)
    if nvr_total and nvr.get("new", 0) / nvr_total >= 0.9:
        score += 1
        reasons.append(f"{round(nvr['new'] / nvr_total * 100)}% usuarios nuevos")

    # 6. Lots of traffic, zero key events
    if users >= 200 and data.get("conversions", 0) == 0 and "purchase" not in events:
        score += 1
        reasons.append("ninguna conversión con tráfico alto")

    return _result(score, reasons)


def _result(score: int, reasons: list[str]) -> dict:
    level = "likely" if score >= 4 else "possible" if score >= 2 else "none"
    return {"level": level, "score": score, "reasons": reasons}

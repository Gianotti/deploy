"""Heuristic bot-traffic detection over GA4 realtime data.

GA4 realtime exposes no IP or user agent, so this can only flag traffic that
*looks* automated. Each signal adds weight; the total maps to a level:
  >= 4 → "likely", >= 2 → "possible", else "none".
Pure function, no I/O — see tests/test_bot_detection.py.
"""

MIN_USERS = 30  # below this, ratios are too noisy to mean anything

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


def assess_bot_suspicion(data: dict, home_country_iso: str | None) -> dict:
    """Return {"level": "none"|"possible"|"likely", "score": int, "reasons": [str]}."""
    users = data.get("active_users") or 0
    result = {"level": "none", "score": 0, "reasons": []}
    if users < MIN_USERS:
        return result

    score = 0
    reasons: list[str] = []

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

    level = "likely" if score >= 4 else "possible" if score >= 2 else "none"
    return {"level": level, "score": score, "reasons": reasons}

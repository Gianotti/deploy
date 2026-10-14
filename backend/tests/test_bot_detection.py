"""Unit tests for the GA4 bot-traffic heuristic (no DB, no GA4)."""

from app.services.bot_detection import assess_bot_suspicion


def human_traffic(users: int = 500) -> dict:
    return {
        "active_users": users,
        "conversions": 8,
        "device_breakdown": {"mobile": int(users * 0.8), "tablet": 0, "desktop": int(users * 0.2)},
        "top_events": [
            {"event": "page_view", "count": users * 3},
            {"event": "user_engagement", "count": users * 2},
            {"event": "scroll", "count": users},
            {"event": "purchase", "count": 8},
        ],
        "new_vs_returning": {"new": int(users * 0.4), "returning": int(users * 0.6)},
        "top_locations": [
            {"country_id": "AR", "city": "Buenos Aires", "users": int(users * 0.6)},
            {"country_id": "AR", "city": "Córdoba", "users": int(users * 0.3)},
            {"country_id": "UY", "city": "Montevideo", "users": int(users * 0.05)},
        ],
    }


def datacenter_bot_traffic(users: int = 1500) -> dict:
    return {
        "active_users": users,
        "conversions": 0,
        "device_breakdown": {"mobile": int(users * 0.1), "tablet": 0, "desktop": int(users * 0.9)},
        "top_events": [
            {"event": "page_view", "count": users},
            {"event": "session_start", "count": users},
        ],
        "new_vs_returning": {"new": users, "returning": 0},
        "top_locations": [
            {"country_id": "US", "city": "Ashburn", "users": int(users * 0.7)},
            {"country_id": "AR", "city": "Buenos Aires", "users": int(users * 0.2)},
        ],
    }


def test_normal_traffic_is_not_flagged():
    r = assess_bot_suspicion(human_traffic(), "ARG")
    assert r["level"] == "none"
    assert r["reasons"] == []


def test_datacenter_traffic_is_likely_bot():
    r = assess_bot_suspicion(datacenter_bot_traffic(), "ARG")
    assert r["level"] == "likely"
    assert any("Ashburn" in reason for reason in r["reasons"])
    assert any("fuera del país" in reason for reason in r["reasons"])


def test_low_traffic_is_never_flagged():
    r = assess_bot_suspicion(datacenter_bot_traffic(users=10), "ARG")
    assert r["level"] == "none"


def test_local_traffic_without_engagement_is_possible():
    data = human_traffic(400)
    data["top_events"] = [{"event": "page_view", "count": 400}]
    data["device_breakdown"] = {"mobile": 40, "tablet": 0, "desktop": 360}
    r = assess_bot_suspicion(data, "ARG")
    assert r["level"] == "possible"


def test_alpha2_country_codes_work():
    r = assess_bot_suspicion(datacenter_bot_traffic(), "AR")
    assert r["level"] == "likely"


def test_unknown_country_skips_foreign_signal():
    r = assess_bot_suspicion(human_traffic(), None)
    assert r["level"] == "none"


def test_missing_optional_data_does_not_crash():
    r = assess_bot_suspicion({"active_users": 800}, "ARG")
    assert r["level"] == "none"


def cf_traffic(requests: int, bots: list[tuple[str, int]]) -> dict:
    return {
        "requests": requests,
        "bot_requests": sum(n for _, n in bots),
        "top_ips": [
            {"ip": f"1.1.1.{i}", "country": "US", "asn": None, "requests": n, "kind": kind, "label": kind}
            for i, (kind, n) in enumerate(bots)
        ],
    }


def test_cloudflare_bot_share_adds_score_even_without_ga4():
    r = assess_bot_suspicion(None, "ARG", cf_traffic(20000, [("ai_crawler", 7000)]))
    assert r["level"] == "possible"
    assert any("Cloudflare" in reason for reason in r["reasons"])


def test_cloudflare_combines_with_ga4_signals():
    data = human_traffic(400)
    data["top_events"] = [{"event": "page_view", "count": 400}]
    data["device_breakdown"] = {"mobile": 40, "tablet": 0, "desktop": 360}
    r = assess_bot_suspicion(data, "ARG", cf_traffic(20000, [("datacenter", 7000)]))
    assert r["level"] == "likely"


def test_search_engines_do_not_count_as_suspicious():
    r = assess_bot_suspicion(None, "ARG", cf_traffic(20000, [("search", 9000)]))
    assert r["level"] == "none"


def test_low_cloudflare_volume_is_ignored():
    r = assess_bot_suspicion(None, "ARG", cf_traffic(100, [("script", 90)]))
    assert r["level"] == "none"

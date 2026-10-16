"""Unit tests for Cloudflare request classification (no network)."""

from app.services.cloudflare_service import classify, normalize_host, resolve_zone


def test_ai_crawlers_are_detected():
    ua = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"
    assert classify(ua, "Microsoft Corporation") == ("ai_crawler", "GPTBot (OpenAI)")


def test_browser_from_datacenter_is_flagged():
    kind, label = classify("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Oracle Corporation")
    assert kind == "datacenter" and "Oracle" in label


def test_residential_browser_is_not_flagged():
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15"
    assert classify(ua, "Telecom Argentina S.A.") is None
    assert classify(ua, None) is None


def test_scripts_and_empty_user_agents():
    assert classify("axios/1.7.2", None)[0] == "script"
    assert classify("", None)[0] == "script"


def test_host_normalization_and_zone_matching():
    zones = [{"id": "1", "name": "tiendamacro.com.ar"}, {"id": "2", "name": "macro.com.ar"}]
    assert normalize_host("https://www.TiendaMacro.com.ar/catalogo") == "tiendamacro.com.ar"
    assert resolve_zone("catalogo.tiendamacro.com.ar", zones)["id"] == "1"
    assert resolve_zone("otrodominio.com", zones) is None


def test_public_summary_groups_bot_ips_by_label():
    from app.services.cloudflare_service import public_summary
    data = {
        "host": "tiendamacro.com.ar", "window_minutes": 15, "requests": 1000,
        "bot_requests": 300, "bot_share": 0.3, "health": {}, "series": [], "firewall": None,
        "top_ips": [
            {"ip": "18.97.9.96", "country": "US", "asn": "Amazon", "requests": 200, "kind": "ai_crawler",
             "label": "PerplexityBot", "paths": [{"path": "/catalog/moda", "requests": 150}]},
            {"ip": "18.97.9.97", "country": "US", "asn": "Amazon", "requests": 100, "kind": "ai_crawler",
             "label": "PerplexityBot", "paths": [{"path": "/catalog/moda", "requests": 60}, {"path": "/", "requests": 40}]},
        ],
    }
    s = public_summary(data)
    [bot] = s["top_bots"]
    assert (bot["label"], bot["requests"], bot["ips"]) == ("PerplexityBot", 300, 2)
    assert [i["ip"] for i in bot["ip_list"]] == ["18.97.9.96", "18.97.9.97"]
    assert bot["paths"] == [{"path": "/catalog/moda", "requests": 210}, {"path": "/", "requests": 40}]


def test_health_buckets_status_codes_and_cache():
    from app.services.cloudflare_service import _health
    z = {
        "total": [{"count": 1000, "avg": {"originResponseDurationMs": 412.6}}],
        "status": [{"count": 900, "dimensions": {"edgeResponseStatus": 200}},
                   {"count": 50, "dimensions": {"edgeResponseStatus": 403}},
                   {"count": 50, "dimensions": {"edgeResponseStatus": 502}}],
        "cache": [{"count": 400, "dimensions": {"cacheStatus": "hit"}},
                  {"count": 600, "dimensions": {"cacheStatus": "dynamic"}}],
    }
    h = _health(z, 1000)
    assert h["status"] == {"2xx": 900, "3xx": 0, "4xx": 50, "5xx": 50}
    assert (h["error_rate"], h["cached_share"], h["origin_ms"]) == (0.05, 0.4, 413)


def test_series_drops_partial_edges():
    from app.services.cloudflare_service import _series
    z = {"series": [{"count": c, "dimensions": {"datetimeMinute": f"t{i}"}} for i, c in enumerate([5, 100, 110, 7])]}
    assert [p["requests"] for p in _series(z)] == [100, 110]


def test_firewall_lists_only_bots_and_flags_blocked_search_engines(monkeypatch):
    from app.services import cloudflare_service as cf
    rows = [
        {"count": 300, "dimensions": {"action": "block", "source": "firewallCustom", "description": "CHALLENGE - BOTS",
         "clientIP": "66.249.73.231", "clientCountryName": "US", "userAgent": "Mozilla/5.0 (compatible; Googlebot/2.1)"}},
        {"count": 50, "dimensions": {"action": "managed_challenge", "source": "firewallCustom", "description": "",
         "clientIP": "190.1.2.3", "clientCountryName": "AR", "userAgent": "Mozilla/5.0 (iPhone)"}},
    ]
    monkeypatch.setattr(cf, "_graphql", lambda *a, **k: {"data": {"viewer": {"zones": [{"events": rows}]}}})
    fw = cf._firewall("t", "zone-fw-test", cf.datetime.now(cf.timezone.utc), None, {})
    assert fw["events"] == 350
    assert fw["by_action"] == {"block": 300, "managed_challenge": 50}
    assert [e["ip"] for e in fw["top_ips"]] == ["66.249.73.231"]   # the residential IP stays aggregated
    assert fw["blocked_search"] == [{"label": "Googlebot", "requests": 300}]


def test_firewall_unavailable_on_plan_returns_none(monkeypatch):
    from app.services import cloudflare_service as cf
    monkeypatch.setattr(cf, "_graphql", lambda *a, **k: {"errors": [{"message": "zone does not have access to the path"}]})
    assert cf._firewall("t", "zone-free-test", cf.datetime.now(cf.timezone.utc), None, {}) is None
    assert "zone-free-test" in cf._no_fw_zones

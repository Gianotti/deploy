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


def test_public_summary_never_contains_ips():
    from app.services.cloudflare_service import public_summary
    data = {
        "host": "tiendamacro.com.ar", "window_minutes": 15, "requests": 1000,
        "bot_requests": 300, "bot_share": 0.3,
        "top_ips": [
            {"ip": "18.97.9.96", "country": "US", "asn": "Amazon", "requests": 200, "kind": "ai_crawler", "label": "PerplexityBot"},
            {"ip": "18.97.9.97", "country": "US", "asn": "Amazon", "requests": 100, "kind": "ai_crawler", "label": "PerplexityBot"},
        ],
    }
    s = public_summary(data)
    assert "18.97.9" not in str(s)
    assert s["top_bots"] == [{"label": "PerplexityBot", "kind": "ai_crawler", "requests": 300, "ips": 2}]

"""Unit tests for the Cloudflare live analytics summary (no network)."""

from app.services.cloudflare_service import ecosystem_analytics, summarize_analytics


def _g(count, status=None, bytes_=0, **dims):
    d = dict(dims)
    if status is not None:
        d["cacheStatus"] = status
    return {"count": count, "sum": {"edgeResponseBytes": bytes_}, "dimensions": d}


RAW = {
    "total": [{"count": 100, "sum": {"edgeResponseBytes": 10_000, "visits": 12}, "avg": {"originResponseDurationMs": 210.4}}],
    "cache": [_g(60, "hit", 7_000), _g(5, "revalidated", 500), _g(25, "dynamic", 2_000), _g(10, "miss", 500)],
    "status": [
        {"count": 90, "dimensions": {"edgeResponseStatus": 200}},
        {"count": 8, "dimensions": {"edgeResponseStatus": 404}},
        {"count": 2, "dimensions": {"edgeResponseStatus": 502}},
    ],
    "paths": [
        _g(40, "hit", clientRequestPath="/static/app.js"),
        _g(20, "dynamic", clientRequestPath="/api/cart"),
        _g(10, "hit", clientRequestPath="/"),
        _g(10, "miss", clientRequestPath="/"),
    ],
    "series": [
        _g(3, "hit", datetimeMinute="2026-11-13T10:00:00Z"),           # first minute: incomplete, dropped
        _g(7, "hit", 70, datetimeMinute="2026-11-13T10:01:00Z"),
        _g(3, "dynamic", 30, datetimeMinute="2026-11-13T10:01:00Z"),
        _g(5, "miss", datetimeMinute="2026-11-13T10:02:00Z"),
        _g(1, "hit", datetimeMinute="2026-11-13T10:03:00Z"),           # last minute: dropped
    ],
}


def test_summary_cache_ratios_count_hit_like_statuses_as_cached():
    s = summarize_analytics(RAW, 15)
    assert s["requests"] == 100 and s["requests_per_min"] == 6.7 and s["visits"] == 12
    assert s["cache"]["cached_requests"] == 65 and s["cache"]["origin_requests"] == 35
    assert s["cache"]["hit_ratio"] == 0.65
    assert s["cache"]["bytes_ratio"] == 0.75
    assert [e["status"] for e in s["cache"]["by_status"]] == ["hit", "dynamic", "miss", "revalidated"]
    assert s["health"]["status"]["5xx"] == 2 and s["health"]["origin_ms"] == 210


def test_summary_paths_merge_cache_statuses_and_series_drop_partial_minutes():
    s = summarize_analytics(RAW, 15)
    root = next(p for p in s["top_paths"] if p["path"] == "/")
    assert root["requests"] == 20 and root["cached_share"] == 0.5
    assert s["top_paths"][0]["path"] == "/static/app.js"
    assert [p["t"][-9:-4] for p in s["series"]] == ["10:01", "10:02"]
    assert s["series"][0] == {"t": "2026-11-13T10:01:00Z", "requests": 10, "cached": 7, "bytes": 100}


def test_summary_empty_zone_has_no_division_errors():
    s = summarize_analytics({"total": [], "cache": [], "status": [], "paths": [], "series": []}, 15)
    assert s["requests"] == 0 and s["cache"]["hit_ratio"] == 0.0 and s["visits"] is None


def test_ecosystem_counts_shared_hosts_once():
    a = {"host": "a.com", **summarize_analytics(RAW, 15)}
    b = {"host": "b.com", **summarize_analytics(RAW, 15)}
    e = ecosystem_analytics([a, b, dict(a)])
    assert e["sites"] == 2 and e["requests"] == 200 and e["hit_ratio"] == 0.65
    assert e["visits"] == 24 and e["error_rate"] == 0.02

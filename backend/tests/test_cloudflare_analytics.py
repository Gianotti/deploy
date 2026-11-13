"""Unit tests for the Cloudflare live analytics summary (no network)."""

from app.services.cloudflare_service import (
    _extras_query, ecosystem_analytics, mask_path, public_analytics, summarize_analytics, summarize_breakdowns,
)


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
    assert s["series"][0] == {"t": "2026-11-13T10:01:00Z", "requests": 10, "cached": 7, "bytes": 100, "cached_bytes": 70}


def test_summary_empty_zone_has_no_division_errors():
    s = summarize_analytics({"total": [], "cache": [], "status": [], "paths": [], "series": []}, 15)
    assert s["requests"] == 0 and s["cache"]["hit_ratio"] == 0.0 and s["visits"] is None


def test_paths_count_4xx_and_5xx_per_path():
    raw = {**RAW, "paths": [
        _g(8, "dynamic", clientRequestPath="/api/pay", edgeResponseStatus=200),
        _g(3, "dynamic", clientRequestPath="/api/pay", edgeResponseStatus=502),
        _g(1, "dynamic", clientRequestPath="/api/pay", edgeResponseStatus=404),
    ]}
    p = summarize_analytics(raw, 15)["top_paths"][0]
    assert (p["requests"], p["errors_4xx"], p["errors_5xx"]) == (12, 1, 3)


def test_mask_path_hides_ids_but_keeps_routes():
    assert mask_path("/orders/12345/items") == "/orders/:id/items"
    assert mask_path("/u/3f2b1c9e-1a2b-4c3d-9e8f-0a1b2c3d4e5f") == "/u/:id"
    assert mask_path("/reset/aB3dE5fG7hJ9kL1mN3pQ5") == "/reset/:id"
    assert mask_path("/_next/static/chunks/main.js") == "/_next/static/chunks/main.js"
    assert mask_path("/promociones/hot-sale-2026") == "/promociones/hot-sale-2026"


def test_public_copy_masks_and_merges_paths_and_keeps_the_rest():
    s = {"host": "a.com", **summarize_analytics({**RAW, "paths": [
        _g(5, "hit", clientRequestPath="/orders/1"),
        _g(3, "miss", clientRequestPath="/orders/2", edgeResponseStatus=500),
    ]}, 15)}
    p = public_analytics(s)
    assert [x["path"] for x in s["top_paths"]] == ["/orders/1", "/orders/2"]  # original untouched
    assert p["top_paths"] == [{"path": "/orders/:id", "requests": 8, "cached": 5, "bytes": 0,
                               "errors_4xx": 0, "errors_5xx": 3, "cached_share": 0.625}]
    assert p["cache"] == s["cache"] and p["series"] == s["series"]


def test_breakdowns_share_of_total_and_status_series():
    z = {
        "countries": [{"count": 30, "sum": {"edgeResponseBytes": 9}, "dimensions": {"clientCountryName": "CO"}},
                      {"count": 10, "sum": {"edgeResponseBytes": 1}, "dimensions": {"clientCountryName": "US"}},
                      {"count": 5, "sum": {"edgeResponseBytes": 0}, "dimensions": {"clientCountryName": "CO"}}],
        "referers": [{"count": 7, "sum": {}, "dimensions": {"clientRefererHost": None}}],
        "status_series": [
            {"count": 1, "dimensions": {"datetimeMinute": "t0", "edgeResponseStatus": 200}},
            {"count": 9, "dimensions": {"datetimeMinute": "t1", "edgeResponseStatus": 200}},
            {"count": 2, "dimensions": {"datetimeMinute": "t1", "edgeResponseStatus": 503}},
            {"count": 1, "dimensions": {"datetimeMinute": "t1", "edgeResponseStatus": 404}},
            {"count": 1, "dimensions": {"datetimeMinute": "t2", "edgeResponseStatus": 200}},
        ],
    }
    b = summarize_breakdowns(z, 100)
    assert b["breakdowns"]["countries"][0] == {"key": "CO", "requests": 35, "bytes": 9, "share": 0.35}
    assert b["breakdowns"]["referers"] == [{"key": "", "requests": 7, "bytes": 0, "share": 0.07}]
    assert "devices" not in b["breakdowns"]   # alias missing (plan without it) -> absent, not empty
    assert b["status_series"] == [{"t": "t1", "2xx": 9, "3xx": 0, "4xx": 1, "5xx": 2}]
    assert summarize_breakdowns({}, 0) == {"breakdowns": {}, "status_series": None}


def test_extras_query_only_declares_variables_it_uses():
    q = _extras_query(["status_series"])
    assert "$f60:" in q and "$f:" not in q
    q = _extras_query(["countries"])
    assert "$f:" in q and "$f60" not in q and "clientCountryName" in q


def test_ecosystem_counts_shared_hosts_once():
    a = {"host": "a.com", **summarize_analytics(RAW, 15)}
    b = {"host": "b.com", **summarize_analytics(RAW, 15)}
    e = ecosystem_analytics([a, b, dict(a)])
    assert e["sites"] == 2 and e["requests"] == 200 and e["hit_ratio"] == 0.65
    assert e["visits"] == 24 and e["error_rate"] == 0.02
    assert [p["requests"] for p in e["series"]] == [20, 10]


def test_ecosystem_merges_breakdowns():
    a = {"host": "a.com", **summarize_analytics(RAW, 15), "breakdowns": {"countries": [{"key": "CO", "requests": 60, "bytes": 1, "share": 0.6}]}}
    b = {"host": "b.com", **summarize_analytics(RAW, 15), "breakdowns": {"countries": [{"key": "CO", "requests": 20, "bytes": 1, "share": 0.2},
                                                                                       {"key": "PE", "requests": 40, "bytes": 0, "share": 0.4}]}}
    e = ecosystem_analytics([a, b])
    assert e["breakdowns"]["countries"] == [{"key": "CO", "requests": 80, "bytes": 2, "share": 0.4},
                                            {"key": "PE", "requests": 40, "bytes": 0, "share": 0.2}]

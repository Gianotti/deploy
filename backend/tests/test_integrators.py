from datetime import datetime, timezone

import pytest

from app.services.integrators import bucket_for, bucket_keys, group_by_integrator, normalize_ip, summarize_zone


def _p(n, ip, path, method="GET", status=200, cache="dynamic", b=10):
    return {"count": n, "sum": {"edgeResponseBytes": b}, "dimensions": {
        "clientIP": ip, "clientRequestPath": path, "clientRequestHTTPMethodName": method,
        "edgeResponseStatus": status, "cacheStatus": cache}}


def _s(n, ip, t):
    return {"count": n, "dimensions": {"clientIP": ip, "datetimeMinute": t}}


def test_normalize_ip():
    assert normalize_ip(" 100.25.27.248 ") == "100.25.27.248"
    assert normalize_ip("2001:0db8:0000:0000:0000:0000:0000:0001") == "2001:db8::1"
    with pytest.raises(ValueError):
        normalize_ip("100.25.27.0/24")
    with pytest.raises(ValueError):
        normalize_ip("sincroshop")


def test_summarize_zone_groups_paths_by_method_and_masked_id():
    owner = {"100.25.27.248": 1, "1.1.1.1": 2}
    z = {
        "paths": [
            _p(50, "100.25.27.248", "/api/v1/products/123"),
            _p(30, "100.25.27.248", "/api/v1/products/456"),
            _p(5, "100.25.27.248", "/api/v1/authenticate", method="POST", status=401),
            _p(2, "100.25.27.248", "/api/v1/orders/", status=502),
            _p(9, "8.8.8.8", "/api/v1/products/1"),          # not an integrator: ignored
            _p(4, "1.1.1.1", "/api/v1/categories", cache="hit"),
        ],
        "series": [_s(40, "100.25.27.248", "t1"), _s(47, "100.25.27.248", "t3"), _s(4, "1.1.1.1", "t2")],
    }
    out = summarize_zone(z, owner, "datetimeMinute", ["t1", "t2", "t3"])
    s = out[1]
    assert (s["requests"], s["errors_4xx"], s["errors_5xx"], s["bytes"]) == (87, 5, 2, 40)
    assert s["paths"][0] == {"method": "GET", "path": "/api/v1/products/:id", "requests": 80, "bytes": 20,
                             "errors_4xx": 0, "errors_5xx": 0, "status": {"200": 80}}
    assert {(p["method"], p["path"]) for p in s["paths"]} >= {("POST", "/api/v1/authenticate")}
    assert s["series"] == [{"t": "t1", "requests": 40}, {"t": "t2", "requests": 0}, {"t": "t3", "requests": 47}]
    assert s["last_seen"] == "t3" and s["ips"] == [{"ip": "100.25.27.248", "requests": 87}]
    assert out[2]["cached"] == 4 and 8 not in out


def test_group_by_integrator_totals_and_unseen_ips():
    owner = {"100.25.27.248": 1}
    z = {"paths": [_p(60, "100.25.27.248", "/api/v1/orders/", status=500)],
         "series": [_s(60, "100.25.27.248", "t1")]}
    rows = [{"client_id": 7, "client_name": "BNA", "site_host": "bna.com", "by_integrator": summarize_zone(z, owner, "datetimeMinute")},
            {"client_id": 8, "client_name": "Otro", "site_host": "otro.com", "by_integrator": {}}]
    its = [{"id": 1, "name": "Sincroshop", "ips": [{"ip": "100.25.27.248", "label": "prod"}, {"ip": "2.2.2.2", "label": None}]},
           {"id": 2, "name": "Quiet", "ips": []}]
    g = group_by_integrator(its, rows, 60)
    assert [e["name"] for e in g] == ["Sincroshop", "Quiet"]
    s = g[0]
    assert (s["requests"], s["requests_per_min"], s["error_rate"], s["last_seen"]) == (60, 1.0, 1.0, "t1")
    assert [c["client_name"] for c in s["clients"]] == ["BNA"]
    assert s["ips"] == [{"ip": "100.25.27.248", "label": "prod", "requests": 60}, {"ip": "2.2.2.2", "label": None, "requests": 0}]
    assert g[1]["requests"] == 0 and g[1]["clients"] == [] and g[1]["last_seen"] is None


def test_buckets():
    assert bucket_for(15) == ("datetimeMinute", 1)
    assert bucket_for(360) == ("datetimeFiveMinutes", 5)
    assert bucket_for(1440) == ("datetimeFifteenMinutes", 15)
    now = datetime(2026, 11, 13, 10, 7, 30, tzinfo=timezone.utc)
    assert bucket_keys(now, 15, 5) == ["2026-11-13T09:50:00Z", "2026-11-13T09:55:00Z", "2026-11-13T10:00:00Z", "2026-11-13T10:05:00Z"]
    assert len(bucket_keys(now, 60, 1)) == 61 and bucket_keys(now, 60, 1)[-1] == "2026-11-13T10:07:00Z"

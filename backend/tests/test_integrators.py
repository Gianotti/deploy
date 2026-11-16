from datetime import datetime, timezone

import pytest

from app.services.integrators import (bucket_for, bucket_keys, group_by_integrator, normalize_ip, normalize_path_prefix,
                                      normalize_ua_pattern, paths_from_text,
                                      summarize_zone, ua_like)


def _p(n, ip, path, method="GET", status=200, cache="dynamic", b=10, ua=""):
    return {"count": n, "sum": {"edgeResponseBytes": b}, "dimensions": {
        "clientIP": ip, "userAgent": ua, "clientRequestPath": path, "clientRequestHTTPMethodName": method,
        "edgeResponseStatus": status, "cacheStatus": cache}}


def _s(n, ip, t, ua=""):
    return {"count": n, "dimensions": {"clientIP": ip, "userAgent": ua, "datetimeMinute": t}}


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
            {"client_id": 8, "client_name": "Otro", "site_host": "otro.com", "by_integrator": {}},
            {"client_id": 9, "client_name": "Ajeno", "site_host": None, "error": "Sin dominio", "by_integrator": {}}]
    its = [{"id": 1, "name": "Sincroshop", "client_ids": [8, 7],
            "ips": [{"ip": "100.25.27.248", "label": "prod"}, {"ip": "2.2.2.2", "label": None}]},
           {"id": 2, "name": "Quiet", "ips": [], "client_ids": [9]},
           {"id": 3, "name": "Unlinked", "ips": [], "client_ids": []}]
    g = group_by_integrator(its, rows, 60)
    assert [e["name"] for e in g] == ["Sincroshop", "Quiet", "Unlinked"]
    s = g[0]
    assert (s["requests"], s["requests_per_min"], s["error_rate"], s["last_seen"]) == (60, 1.0, 1.0, "t1")
    # Linked clients only, also the ones without traffic; busiest first.
    assert [(c["client_name"], c["requests"]) for c in s["clients"]] == [("BNA", 60), ("Otro", 0)]
    assert s["ips"] == [{"ip": "100.25.27.248", "label": "prod", "requests": 60}, {"ip": "2.2.2.2", "label": None, "requests": 0}]
    assert g[1]["requests"] == 0 and g[1]["clients"][0]["error"] == "Sin dominio" and g[1]["last_seen"] is None
    assert g[2]["clients"] == []


def test_normalize_ua_pattern():
    assert normalize_ua_pattern("  Sincroshop-Bot/2 ") == "Sincroshop-Bot/2"
    for bad in ("", "abc", "foo%bar"):
        with pytest.raises(ValueError):
            normalize_ua_pattern(bad)
    assert ua_like("okhttp") == "%okhttp%"


def test_summarize_zone_matches_by_user_agent():
    owner = {"100.25.27.248": 1}
    ua_owner = [("Sincro", 1), ("VtexIO_", 2), ("VtexIO_Sync", 3)]
    z = {"paths": [
            _p(10, "100.25.27.248", "/a", ua="curl/8"),                    # registered IP wins
            _p(7, "5.5.5.5", "/b", ua="Mozilla Sincroshop/2"),             # contains, any IP
            _p(3, "6.6.6.6", "/c", ua="sincroshop/2"),                     # case-sensitive: ignored
            _p(4, "7.7.7.7", "/d", ua="VtexIO_Sync/1"),                    # longest pattern wins
            _p(2, "8.8.8.8", "/e", ua="VtexIO-Other"),                     # `_` is any char
         ],
         "series": [_s(17, "5.5.5.5", "t1", ua="Mozilla Sincroshop/2"), _s(4, "7.7.7.7", "t1", ua="VtexIO_Sync/1")]}
    out = summarize_zone(z, owner, "datetimeMinute", ["t1"], ua_owner)
    assert out[1]["requests"] == 17 and out[1]["agents"] == [{"pattern": "Sincro", "requests": 7}]
    assert out[1]["series"] == [{"t": "t1", "requests": 17}]
    assert out[3]["requests"] == 4 and out[2]["requests"] == 2
    rows = [{"client_id": 7, "client_name": "BNA", "site_host": "bna.com", "by_integrator": out}]
    its = [{"id": 1, "name": "Sincroshop", "client_ids": [7], "ips": [{"ip": "100.25.27.248", "label": None}],
            "user_agents": [{"pattern": "Sincro", "label": "app"}]}]
    g = group_by_integrator(its, rows, 60)[0]
    assert g["user_agents"] == [{"pattern": "Sincro", "label": "app", "requests": 7, "shared_with": []}]
    assert g["detected_ips"] == [{"ip": "5.5.5.5", "requests": 7}]
    assert g["ua_seen"][0] == {"user_agent": "curl/8", "requests": 10}


def test_shared_user_agent_counts_for_each_integrator():
    # Two integrators use the same SDK User-Agent; a third has a more specific one.
    ua_owner = [("AcmeSDK/", 1), ("AcmeSDK/", 2), ("AcmeSDK/3 Shop", 3)]
    z = {"paths": [_p(10, "5.5.5.5", "/a", ua="AcmeSDK/2"),
                   _p(4, "6.6.6.6", "/b", ua="AcmeSDK/3 Shop"),       # longest wins: only #3
                   _p(1, "7.7.7.7", "/c", ua="AcmeSDK/2")],
         "series": [_s(11, "5.5.5.5", "t1", ua="AcmeSDK/2")]}
    out = summarize_zone(z, {"7.7.7.7": 2}, "datetimeMinute", ["t1"], ua_owner)
    assert (out[1]["requests"], out[1]["shared"]) == (10, 10)
    assert (out[2]["requests"], out[2]["shared"]) == (11, 10)            # +1 from its own IP, not shared
    assert (out[3]["requests"], out[3]["shared"]) == (4, 0)
    assert out[1]["series"] == out[2]["series"] == [{"t": "t1", "requests": 11}]
    rows = [{"client_id": 7, "client_name": "BNA", "site_host": "bna.com", "by_integrator": out}]
    its = [{"id": i, "name": n, "client_ids": [7], "ips": [], "user_agents": [{"pattern": "AcmeSDK/", "label": None}]}
           for i, n in ((1, "Uno"), (2, "Dos"))]
    g = {e["id"]: e for e in group_by_integrator(its, rows, 60)}
    assert g[1]["shared_requests"] == 10 and g[1]["user_agents"][0]["shared_with"] == ["Dos"]


def test_normalize_path_prefix_and_paths_from_text():
    assert normalize_path_prefix(" api/v1/products/ ") == "/api/v1/products/"
    assert normalize_path_prefix("https://bna.com/api/v1/orders/?x=1") == "/api/v1/orders/"
    for bad in ("/", "", "/a b", "/a%"):
        with pytest.raises(ValueError):
            normalize_path_prefix(bad)
    notes = "Consume BNA: api/v1/authenticate, api/v1/products/, api/v1/orders/. Soporte 24/7 y/o mail."
    assert paths_from_text(notes) == ["/api/v1/authenticate", "/api/v1/products/", "/api/v1/orders/"]
    assert paths_from_text(None) == []


def test_summarize_zone_only_counts_consumed_paths():
    owner = {"1.1.1.1": 1}
    z = {"paths": [_p(10, "1.1.1.1", "/api/v1/products/9"),
                   _p(9, "1.1.1.1", "/login/", status=403),                 # scanner path: not its own
                   _p(3, "5.5.5.5", "/api/v1/orders/1", ua="AcmeSDK/2"),
                   _p(2, "5.5.5.5", "/login_up.php", method="POST", ua="AcmeSDK/2", status=403)],
         "series": [{"count": 10, "dimensions": {"clientIP": "1.1.1.1", "userAgent": "",
                                                 "clientRequestPath": "/api/v1/products/9", "datetimeMinute": "t1"}},
                    {"count": 9, "dimensions": {"clientIP": "1.1.1.1", "userAgent": "",
                                                "clientRequestPath": "/login/", "datetimeMinute": "t1"}}]}
    out = summarize_zone(z, owner, "datetimeMinute", ["t1"], [("AcmeSDK/", 2)],
                         {1: ["/api/v1/products/"], 2: ["/api/v1/orders/"]})
    assert out[1]["requests"] == 10 and out[1]["errors_4xx"] == 0
    assert out[1]["series"] == [{"t": "t1", "requests": 10}]
    assert out[2]["requests"] == 3 and [p["path"] for p in out[2]["paths"]] == ["/api/v1/orders/:id"]
    # No prefixes = any path (previous behaviour).
    assert summarize_zone(z, owner, "datetimeMinute", ["t1"])[1]["requests"] == 19


def test_buckets():
    assert bucket_for(15) == ("datetimeMinute", 1)
    assert bucket_for(360) == ("datetimeFiveMinutes", 5)
    assert bucket_for(1440) == ("datetimeFifteenMinutes", 15)
    now = datetime(2026, 11, 13, 10, 7, 30, tzinfo=timezone.utc)
    assert bucket_keys(now, 15, 5) == ["2026-11-13T09:50:00Z", "2026-11-13T09:55:00Z", "2026-11-13T10:00:00Z", "2026-11-13T10:05:00Z"]
    assert len(bucket_keys(now, 60, 1)) == 61 and bucket_keys(now, 60, 1)[-1] == "2026-11-13T10:07:00Z"

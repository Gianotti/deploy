"""Unit tests for the CMO metrics (no DB, no GA4)."""

from datetime import date, timedelta

from app.services import executive as ex

END = date(2026, 11, 4)


def series(days: int = 70, sessions: float = 100, purchases: float = 2, revenue: float = 1000, conversions: float = 5,
           overrides: dict[date, dict] | None = None) -> list[dict]:
    rows = {}
    for i in range(days):
        d = END - timedelta(days=i)
        rows[d] = {"sessions": sessions, "purchases": purchases, "revenue": revenue, "conversions": conversions}
    for d, v in (overrides or {}).items():
        rows[d] = {**rows.get(d, {}), **v}
    return ex.fill_series(rows, END, days)


def test_fill_series_is_dense_and_zero_filled():
    s = ex.fill_series({END: {"sessions": 5}}, END, 3)
    assert [r["date"] for r in s] == ["2026-11-02", "2026-11-03", "2026-11-04"]
    assert s[0]["sessions"] == 0 and s[-1]["sessions"] == 5 and s[-1]["revenue"] == 0


def test_window_sum_current_and_previous():
    s = series(overrides={END: {"sessions": 800}})
    assert ex.window_sum(s, END, 7)["sessions"] == 6 * 100 + 800
    assert ex.window_sum(s, END, 7, offset=7)["sessions"] == 700


def test_conversion_key_falls_back_to_key_events_without_purchases():
    assert ex.conversion_key(series()) == "purchases"
    assert ex.conversion_key(series(purchases=0)) == "conversions"


def test_client_kpis_without_ecommerce_has_no_revenue_or_aov():
    k = ex.client_kpis(series(purchases=0, revenue=0), END)
    assert k["conversion_key"] == "conversions"
    assert k["revenue"] is None and k["avg_order_value"] is None
    assert k["conversion_rate"]["cur"] == 5 / 100


def test_client_kpis_with_ecommerce():
    k = ex.client_kpis(series(), END)
    assert k["conversions"]["cur"] == 14
    assert k["revenue"]["cur"] == 7000
    assert k["avg_order_value"]["cur"] == 500


def test_promo_lift_against_clean_baseline():
    start, finish = END - timedelta(days=2), END
    promo = {d: {"sessions": 300, "purchases": 6, "revenue": 3000} for d in ex.promo_dates(start, finish)}
    s = series(overrides=promo)
    lift = ex.promo_lift(s, start, finish, END, ex.promo_dates(start, finish), "purchases")
    assert lift["days_measured"] == 3 and lift["baseline_days"] == ex.BASELINE_DAYS
    assert lift["sessions"]["lift"] == 2.0
    assert lift["conversions"]["lift"] == 2.0
    assert lift["revenue"]["lift"] == 2.0


def test_promo_lift_excludes_other_promo_days_from_baseline():
    start, finish = END - timedelta(days=1), END
    earlier = ex.promo_dates(END - timedelta(days=10), END - timedelta(days=5))
    # the earlier promo had huge traffic; if it leaked into the baseline the lift would be negative
    s = series(overrides={**{d: {"sessions": 10_000} for d in earlier},
                          **{d: {"sessions": 200} for d in ex.promo_dates(start, finish)}})
    lift = ex.promo_lift(s, start, finish, END, earlier | ex.promo_dates(start, finish), "purchases")
    assert lift["sessions"]["lift"] == 1.0


def test_promo_lift_future_or_without_baseline_is_none():
    assert ex.promo_lift(series(), END + timedelta(days=1), END + timedelta(days=3), END, set(), "purchases") is None
    short = series(days=5)
    assert ex.promo_lift(short, END - timedelta(days=1), END, END, set(), "purchases") is None


def test_ecosystem_groups_revenue_by_currency_and_rate_only_counts_ecommerce():
    ecom = {"currency": "ARS", "kpis": ex.client_kpis(series(), END)}
    ecom2 = {"currency": "MXN", "kpis": ex.client_kpis(series(revenue=10), END)}
    leads = {"currency": "ARS", "kpis": ex.client_kpis(series(sessions=1000, purchases=0, revenue=0), END)}
    no_data = {"currency": None, "kpis": None}
    e = ex.ecosystem_kpis([ecom, ecom2, leads, no_data])
    assert e["clients_with_data"] == 3 and e["ecommerce_clients"] == 2
    assert e["sessions"]["cur"] == 700 + 700 + 7000
    assert e["purchases"]["cur"] == 28
    assert e["purchase_rate"]["cur"] == 28 / 1400
    assert [r["currency"] for r in e["revenue"]] == ["ARS", "MXN"]
    assert e["revenue"][0]["cur"] == 7000 and e["revenue"][0]["clients"] == 1
    # Ticket / revenue per session per currency (ARS: 7000 / 14 orders, 7000 / 700 sessions)
    assert e["revenue"][0]["avg_order_value"]["cur"] == 500
    assert e["revenue"][0]["revenue_per_session"]["cur"] == 10


def test_client_kpis_revenue_per_session():
    k = ex.client_kpis(series(), END)
    assert k["revenue_per_session"]["cur"] == 10
    assert ex.client_kpis(series(purchases=0, revenue=0), END)["revenue_per_session"] is None


# ── Month to date ────────────────────────────────────────────────────────────

def test_month_to_date_vs_same_days_of_previous_month_and_projection():
    s = series(overrides={date(2026, 10, 2): {"sessions": 1100}, date(2026, 10, 20): {"sessions": 5000}})
    m = ex.month_to_date(s, END)  # Nov 1–4 vs Oct 1–4
    assert m["month"] == "2026-11" and m["days_elapsed"] == 4 and m["days_in_month"] == 30
    assert m["cur"]["sessions"] == 400
    assert m["prev"]["sessions"] == 300 + 1100
    assert m["prev_full"]["sessions"] == 29 * 100 + 1100 + 5000
    assert m["projection"]["sessions"] == 400 * 30 / 4


def test_month_to_date_clamps_to_short_previous_month():
    end = date(2026, 3, 31)
    rows = {end - timedelta(days=i): {"sessions": 1} for i in range(70)}
    m = ex.month_to_date(ex.fill_series(rows, end, 70), end)
    assert m["prev"]["sessions"] == 28  # Feb 2026 has 28 days
    assert m["projection"]["sessions"] == m["cur"]["sessions"] == 31


def test_ecosystem_mtd_sums_and_groups_by_currency():
    def block(cur, **kw):
        s = series(**kw)
        return {"currency": cur, "kpis": ex.client_kpis(s, END), "mtd": ex.month_to_date(s, END)}
    e = ex.ecosystem_mtd([block("ARS"), block("ARS"), block("MXN", purchases=0, revenue=0), {"kpis": None}])
    assert e["sessions"]["cur"] == 1200
    assert e["purchases"]["cur"] == 16
    assert [r["currency"] for r in e["revenue"]] == ["ARS"]
    assert e["revenue"][0]["cur"] == 8000 and e["revenue"][0]["projection"] == 60000
    assert ex.ecosystem_mtd([{"kpis": None}]) is None


# ── Promo ranking ────────────────────────────────────────────────────────────

def _res(ptype, conv, rev=None):
    return {"promo_type": ptype, "conversions": {"lift": conv}, "revenue": {"lift": rev}}


def test_promo_ranking_groups_by_type_and_sorts_by_lift():
    r = ex.promo_ranking([_res("PROMO_NORMAL", 0.1), _res("PROMO_NORMAL", -0.3),
                          _res("PROMO_ESPECIAL", 0.5, 0.6), _res("PROMO_ESPECIAL", None)])
    assert [g["promo_type"] for g in r] == ["PROMO_ESPECIAL", "PROMO_NORMAL"]
    esp, norm = r
    assert esp["count"] == 2 and esp["avg_conversion_lift"] == 0.5 and esp["avg_revenue_lift"] == 0.6
    assert norm["avg_conversion_lift"] == -0.1 and norm["win_rate"] == 0.5 and norm["avg_revenue_lift"] is None


# ── Traffic quality ──────────────────────────────────────────────────────────

def test_traffic_quality_flags_junk_and_ignores_small_campaigns():
    junk = {"sessions": 1000, "engaged_sessions": 30, "engagement_seconds": 1000, "purchases": 0}
    q = ex.traffic_quality(junk, "purchases")
    assert q["level"] == "likely" and q["score"] == 6 and len(q["reasons"]) == 3
    good = {"sessions": 1000, "engaged_sessions": 600, "engagement_seconds": 60000, "purchases": 12}
    assert ex.traffic_quality(good, "purchases")["level"] == "ok"
    meh = {"sessions": 200, "engaged_sessions": 30, "engagement_seconds": 4000, "purchases": 0}
    assert ex.traffic_quality(meh, "purchases")["level"] == "possible"
    assert ex.traffic_quality({"sessions": 50, "engaged_sessions": 0}, "purchases")["level"] == "insufficient"


# ── Funnel / segments ────────────────────────────────────────────────────────

def test_funnel_steps():
    f = ex.funnel_steps({"view_item": 1000, "add_to_cart": 200, "begin_checkout": 80, "purchase": 40})
    assert [s["from_prev"] for s in f["steps"]] == [None, 0.2, 0.4, 0.5]
    assert f["cart_abandonment"] == 0.8 and f["view_to_purchase"] == 0.04
    # missing view_item: the next step has no ratio rather than dividing by zero
    f2 = ex.funnel_steps({"add_to_cart": 50, "purchase": 10})
    assert f2["steps"][1]["from_prev"] is None and f2["steps"][3]["from_prev"] == 0.2
    assert ex.funnel_steps({"view_item": 10}) is None and ex.funnel_steps(None) is None


def test_segment_rows_share_and_rate():
    rows = ex.segment_rows([{"segment": "mobile", "sessions": 300, "purchases": 3, "engaged_sessions": 150},
                            {"segment": "desktop", "sessions": 100, "purchases": 4}], "purchases")
    assert rows[0]["share"] == 0.75 and rows[0]["conversion_rate"] == 0.01 and rows[0]["engagement_rate"] == 0.5
    assert rows[1]["conversion_rate"] == 0.04 and rows[1]["engagement_rate"] == 0


# ── Calendar load ────────────────────────────────────────────────────────────

def test_calendar_load_splits_past_and_ahead():
    st = {date(2026, 11, d): "LIBRE" for d in range(1, 31)}
    st[date(2026, 11, 2)] = "BLOQUEADO"
    st[date(2026, 11, 4)] = "RESTRINGIDO"
    st[date(2026, 11, 20)] = "BLOQUEADO"
    st[date(2026, 11, 21)] = "BLOQUEADO"
    c = ex.calendar_load(st, END)
    assert c == {"blocked_past": 1, "blocked_ahead": 2, "restricted_past": 1, "restricted_ahead": 0,
                 "days_in_month": 30}


# ── Alerts / digest ──────────────────────────────────────────────────────────

def _client(name, **kw):
    return {"client_id": hash(name) % 100, "client_name": name, "currency": "ARS",
            "kpis": ex.client_kpis(series(**kw), END)}


def test_alerts_only_for_big_drops_on_big_clients():
    drop = {END - timedelta(days=i): {"sessions": 50, "purchases": 2, "revenue": 1000} for i in range(7)}
    big = _client("Grande", sessions=100, overrides=drop)
    small = _client("Chico", sessions=10, overrides={END - timedelta(days=i): {"sessions": 1} for i in range(7)})
    al = ex.alerts([big, small, {"client_id": 9, "client_name": "x", "kpis": None}])
    assert [(a["client_name"], a["metric"]) for a in al] == [("Grande", "sessions")]
    assert al[0]["change"] == -0.5


def test_digest_text_mentions_totals_alerts_and_link():
    clients = [_client("Banco A")]
    overview = {
        "ecosystem": ex.ecosystem_kpis(clients),
        "mtd": None,
        "clients": [{**clients[0], "promo_results": []}],
        "alerts": [{"client_name": "Banco A", "label": "Sesiones", "change": -0.31}],
        "suspicious_campaigns": [],
        "upcoming": [{}, {}],
    }
    text = ex.digest_text(overview, "https://deploy.example.com/")
    assert "Ingresos ARS: *ARS 7.000* (0%)" in text
    assert "Banco A: sesiones -31%" in text
    assert "2 promos en los próximos 14 días" in text
    assert text.endswith("https://deploy.example.com/executive")

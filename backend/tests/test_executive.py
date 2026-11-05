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

"""Business metrics for the CMO view (/executive). Pure functions, no I/O.

Input is a daily series per client built from the GA4 Data API (see
ga4_reports.py). Everything is computed over *complete* days only: `end` is
yesterday in the client's timezone, because today's GA4 data is partial.

Sessions are used as the traffic measure (they add up across days; daily
active users do not). The conversion measure is `purchases` when the property
reports ecommerce purchases, otherwise GA4 key events (`conversions`).
"""

from datetime import date, timedelta

METRICS = ("sessions", "conversions", "purchases", "revenue")

BASELINE_DAYS = 14       # clean days before a promo used as its baseline
BASELINE_LOOKBACK = 42   # how far back we search for those clean days
BASELINE_MIN_DAYS = 5    # below this, a lift number would be noise
PROMO_LOOKBACK = 30      # report promos active in the last N days


def empty_day(d: date) -> dict:
    return {"date": d.isoformat(), **{m: 0 for m in METRICS}}


def fill_series(rows: dict[date, dict], end: date, days: int) -> list[dict]:
    """Dense series of `days` days ending on `end` (inclusive); missing days are zero."""
    out = []
    for i in range(days - 1, -1, -1):
        d = end - timedelta(days=i)
        row = empty_day(d)
        row.update({m: rows.get(d, {}).get(m, 0) for m in METRICS})
        out.append(row)
    return out


def window_sum(series: list[dict], end: date, days: int, offset: int = 0) -> dict:
    """Sum of metrics over the `days` days ending `offset` days before `end`."""
    last = end - timedelta(days=offset)
    first = last - timedelta(days=days - 1)
    totals = {m: 0.0 for m in METRICS}
    for row in series:
        d = date.fromisoformat(row["date"])
        if first <= d <= last:
            for m in METRICS:
                totals[m] += row[m]
    return totals


def conversion_key(series: list[dict]) -> str:
    return "purchases" if any(r["purchases"] > 0 for r in series) else "conversions"


def rate(num: float, den: float) -> float | None:
    return num / den if den > 0 else None


def promo_dates(start: date, end: date) -> set[date]:
    return {start + timedelta(days=i) for i in range((end - start).days + 1)}


def promo_lift(
    series: list[dict],
    start: date,
    finish: date,
    end: date,
    busy: set[date],
    conv_key: str,
) -> dict | None:
    """Average daily performance during a promo vs. clean days just before it.

    `busy` holds every date on which the client had any promo; those days are
    excluded from the baseline so one promo isn't measured against another.
    Returns None when the promo hasn't started yet or there is no usable baseline.
    """
    by_date = {date.fromisoformat(r["date"]): r for r in series}
    promo_days = [d for d in promo_dates(start, min(finish, end)) if d in by_date]
    if not promo_days:
        return None

    baseline: list[date] = []
    d = start - timedelta(days=1)
    while len(baseline) < BASELINE_DAYS and (start - d).days <= BASELINE_LOOKBACK:
        if d in by_date and d not in busy:
            baseline.append(d)
        d -= timedelta(days=1)
    if len(baseline) < BASELINE_MIN_DAYS:
        return None

    def avg(days: list[date], m: str) -> float:
        return sum(by_date[x][m] for x in days) / len(days)

    out: dict = {"days_measured": len(promo_days), "baseline_days": len(baseline)}
    for label, m in (("sessions", "sessions"), ("conversions", conv_key), ("revenue", "revenue")):
        during, base = avg(promo_days, m), avg(baseline, m)
        out[label] = {"during": round(during, 2), "baseline": round(base, 2),
                      "lift": round(during / base - 1, 4) if base > 0 else None}
    return out


def client_kpis(series: list[dict], end: date, window: int = 7) -> dict:
    """Current window vs. the previous one, plus conversion rate."""
    key = conversion_key(series)
    cur = window_sum(series, end, window)
    prev = window_sum(series, end, window, offset=window)
    has_revenue = any(r["revenue"] > 0 for r in series)
    return {
        "conversion_key": key,
        "has_revenue": has_revenue,
        "sessions": {"cur": cur["sessions"], "prev": prev["sessions"]},
        "conversions": {"cur": cur[key], "prev": prev[key]},
        "revenue": {"cur": cur["revenue"], "prev": prev["revenue"]} if has_revenue else None,
        "conversion_rate": {"cur": rate(cur[key], cur["sessions"]), "prev": rate(prev[key], prev["sessions"])},
        "avg_order_value": {
            "cur": rate(cur["revenue"], cur["purchases"]),
            "prev": rate(prev["revenue"], prev["purchases"]),
        } if has_revenue and key == "purchases" else None,
    }


def ecosystem_kpis(clients: list[dict]) -> dict:
    """Roll-up over clients that returned data.

    Revenue is grouped by currency (clients sell in ARS, MXN, ... and there is
    no FX source). Purchases and purchase rate only count ecommerce clients,
    so a client that reports key events instead doesn't dilute the rate.
    """
    ok = [c for c in clients if c.get("kpis")]
    ecom = [c for c in ok if c["kpis"]["conversion_key"] == "purchases"]

    def total(group: list[dict], field: str, period: str) -> float:
        return sum(c["kpis"][field][period] for c in group)

    revenue: dict[str, dict] = {}
    for c in ok:
        r = c["kpis"]["revenue"]
        if r:
            cur = revenue.setdefault(c.get("currency") or "?", {"cur": 0.0, "prev": 0.0, "clients": 0})
            cur["cur"] += r["cur"]
            cur["prev"] += r["prev"]
            cur["clients"] += 1

    return {
        "clients_with_data": len(ok),
        "ecommerce_clients": len(ecom),
        "sessions": {p: total(ok, "sessions", p) for p in ("cur", "prev")},
        "purchases": {p: total(ecom, "conversions", p) for p in ("cur", "prev")},
        "purchase_rate": {
            p: rate(total(ecom, "conversions", p), total(ecom, "sessions", p)) for p in ("cur", "prev")
        },
        "revenue": [{"currency": k, **v} for k, v in sorted(revenue.items(), key=lambda kv: -kv[1]["cur"])],
    }

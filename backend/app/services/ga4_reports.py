"""GA4 Data API (historical reports) for the CMO view.

One batchRunReports call per property returns three reports:
  0. daily series   — sessions, key events, purchases, revenue per date
  1. channels (7d)  — sessionDefaultChannelGroup
  2. campaigns (7d) — sessionCampaignName + sessionSourceMedium

Results are cached per property for CACHE_TTL. On any API error the last good
result is returned (with `stale: True`) so a quota blip doesn't blank the page.
"""

import threading
import time
from datetime import date, datetime

from google.analytics.data_v1beta.types import (
    BatchRunReportsRequest,
    DateRange,
    Dimension,
    Metric,
    OrderBy,
    RunReportRequest,
)

from app.services.ga4_service import get_ga4_client

SERIES_DAYS = 70   # promo baseline needs ~6 weeks before promos from the last 30 days
CACHE_TTL = 3600   # GA4 historical data updates a few times a day; hourly is plenty

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}

_DAILY_METRICS = ("sessions", "keyEvents", "ecommercePurchases", "purchaseRevenue")
_BREAKDOWN_METRICS = ("sessions", "keyEvents", "ecommercePurchases", "purchaseRevenue")


def _num(v: str) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _metrics(names: tuple[str, ...]) -> list[Metric]:
    return [Metric(name=m) for m in names]


def _row_metrics(row) -> dict:
    s, k, p, r = (_num(x.value) for x in row.metric_values)
    return {"sessions": s, "conversions": k, "purchases": p, "revenue": r}


def fetch_property(credentials_json: str, property_id: str, max_age: float = CACHE_TTL) -> dict:
    prop = property_id if property_id.startswith("properties/") else f"properties/{property_id}"

    with _lock:
        cached = _cache.get(prop)
    if cached and time.time() - cached[0] < max_age:
        return cached[1]

    last7 = [DateRange(start_date="7daysAgo", end_date="yesterday")]
    sessions_desc = [OrderBy(metric=OrderBy.MetricOrderBy(metric_name="sessions"), desc=True)]
    try:
        ga = get_ga4_client(credentials_json)
        resp = ga.batch_run_reports(BatchRunReportsRequest(
            property=prop,
            requests=[
                RunReportRequest(
                    date_ranges=[DateRange(start_date=f"{SERIES_DAYS}daysAgo", end_date="yesterday")],
                    dimensions=[Dimension(name="date")],
                    metrics=_metrics(_DAILY_METRICS),
                    limit=SERIES_DAYS + 5,
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="sessionDefaultChannelGroup")],
                    metrics=_metrics(_BREAKDOWN_METRICS),
                    order_bys=sessions_desc,
                    limit=8,
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="sessionCampaignName"), Dimension(name="sessionSourceMedium")],
                    metrics=_metrics(_BREAKDOWN_METRICS),
                    order_bys=sessions_desc,
                    limit=25,
                ),
            ],
        ))
        daily_r, channels_r, campaigns_r = resp.reports

        daily: dict[date, dict] = {}
        for row in daily_r.rows:
            d = datetime.strptime(row.dimension_values[0].value, "%Y%m%d").date()
            daily[d] = _row_metrics(row)

        channels = [
            {"channel": row.dimension_values[0].value, **_row_metrics(row)}
            for row in channels_r.rows
        ]
        # "(not set)"/"(direct)"/"(organic)" are GA4 placeholders, not campaigns
        campaigns = [
            {"campaign": row.dimension_values[0].value, "source_medium": row.dimension_values[1].value, **_row_metrics(row)}
            for row in campaigns_r.rows
            if not row.dimension_values[0].value.startswith("(")
        ][:10]

        result = {
            "currency": daily_r.metadata.currency_code or None,
            "time_zone": daily_r.metadata.time_zone or None,
            "daily": daily,
            "channels": channels,
            "campaigns": campaigns,
            "stale": False,
            "error": None,
        }
        with _lock:
            _cache[prop] = (time.time(), result)
        return result
    except Exception as e:  # noqa: BLE001 — any API failure falls back to the cache
        if cached:
            return {**cached[1], "stale": True}
        return {"daily": {}, "channels": [], "campaigns": [], "currency": None,
                "time_zone": None, "stale": False, "error": str(e)}

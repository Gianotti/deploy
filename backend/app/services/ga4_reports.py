"""GA4 Data API (historical reports) for the CMO view.

Two batchRunReports calls per property (GA4 allows up to 5 reports per batch):

Batch 1 (required — a failure here is a failure of the whole property):
  0. daily series      — sessions, key events, purchases, revenue per date (SERIES_DAYS)
  1. channels (7d)     — sessionDefaultChannelGroup (+ engagement)
  2. campaigns (7d)    — sessionCampaignName + sessionSourceMedium (+ engagement)
  3. devices (7d)      — deviceCategory
  4. new vs returning  — newVsReturning (7d)

Batch 2 (optional — ecommerce detail; on failure the page just omits it):
  0. funnel (7d)       — eventCount for view_item / add_to_cart / begin_checkout / purchase
  1. products (7d)     — itemName by itemRevenue

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
    Filter,
    FilterExpression,
    Metric,
    OrderBy,
    RunReportRequest,
)

from app.services.ga4_service import get_ga4_client

# Long enough to rank promos from the last ~4 months against a 6-week baseline,
# and to compare the month to date against the previous month.
SERIES_DAYS = 180
CACHE_TTL = 3600   # GA4 historical data updates a few times a day; hourly is plenty

FUNNEL_EVENTS = ("view_item", "add_to_cart", "begin_checkout", "purchase")

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}

# GA4 metric name → key in our rows
_BASE = {"sessions": "sessions", "keyEvents": "conversions",
         "ecommercePurchases": "purchases", "purchaseRevenue": "revenue"}
_ENGAGEMENT = {**_BASE, "engagedSessions": "engaged_sessions",
               "userEngagementDuration": "engagement_seconds"}
_ITEMS = {"itemRevenue": "revenue", "itemsPurchased": "quantity", "itemsViewed": "views"}


def _num(v: str) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _metrics(spec: dict[str, str]) -> list[Metric]:
    return [Metric(name=m) for m in spec]


def _row(row, spec: dict[str, str]) -> dict:
    return {key: _num(v.value) for key, v in zip(spec.values(), row.metric_values)}


def _desc(metric: str) -> list[OrderBy]:
    return [OrderBy(metric=OrderBy.MetricOrderBy(metric_name=metric), desc=True)]


def _ecommerce_detail(ga, prop: str, last7: list[DateRange]) -> tuple[dict | None, list[dict]]:
    try:
        resp = ga.batch_run_reports(BatchRunReportsRequest(
            property=prop,
            requests=[
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="eventName")],
                    metrics=[Metric(name="eventCount")],
                    dimension_filter=FilterExpression(filter=Filter(
                        field_name="eventName",
                        in_list_filter=Filter.InListFilter(values=list(FUNNEL_EVENTS)),
                    )),
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="itemName")],
                    metrics=_metrics(_ITEMS),
                    order_bys=_desc("itemRevenue"),
                    limit=12,
                ),
            ],
        ))
    except Exception:  # noqa: BLE001 — optional detail, never fails the property
        return None, []
    funnel_r, items_r = resp.reports
    events = {row.dimension_values[0].value: _num(row.metric_values[0].value) for row in funnel_r.rows}
    items = [
        {"item": row.dimension_values[0].value, **_row(row, _ITEMS)}
        for row in items_r.rows
        if not row.dimension_values[0].value.startswith("(")
    ][:10]
    return (events or None), items


def fetch_property(credentials_json: str, property_id: str, max_age: float = CACHE_TTL) -> dict:
    prop = property_id if property_id.startswith("properties/") else f"properties/{property_id}"

    with _lock:
        cached = _cache.get(prop)
    if cached and time.time() - cached[0] < max_age:
        return cached[1]

    last7 = [DateRange(start_date="7daysAgo", end_date="yesterday")]
    try:
        ga = get_ga4_client(credentials_json)
        resp = ga.batch_run_reports(BatchRunReportsRequest(
            property=prop,
            requests=[
                RunReportRequest(
                    date_ranges=[DateRange(start_date=f"{SERIES_DAYS}daysAgo", end_date="yesterday")],
                    dimensions=[Dimension(name="date")],
                    metrics=_metrics(_BASE),
                    limit=SERIES_DAYS + 5,
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="sessionDefaultChannelGroup")],
                    metrics=_metrics(_ENGAGEMENT),
                    order_bys=_desc("sessions"),
                    limit=8,
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="sessionCampaignName"), Dimension(name="sessionSourceMedium")],
                    metrics=_metrics(_ENGAGEMENT),
                    order_bys=_desc("sessions"),
                    limit=25,
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="deviceCategory")],
                    metrics=_metrics(_ENGAGEMENT),
                    order_bys=_desc("sessions"),
                ),
                RunReportRequest(
                    date_ranges=last7,
                    dimensions=[Dimension(name="newVsReturning")],
                    metrics=_metrics(_ENGAGEMENT),
                    order_bys=_desc("sessions"),
                ),
            ],
        ))
        daily_r, channels_r, campaigns_r, devices_r, nvr_r = resp.reports

        daily: dict[date, dict] = {}
        for row in daily_r.rows:
            d = datetime.strptime(row.dimension_values[0].value, "%Y%m%d").date()
            daily[d] = _row(row, _BASE)

        channels = [{"channel": row.dimension_values[0].value, **_row(row, _ENGAGEMENT)} for row in channels_r.rows]
        # "(not set)"/"(direct)"/"(organic)" are GA4 placeholders, not campaigns
        campaigns = [
            {"campaign": row.dimension_values[0].value, "source_medium": row.dimension_values[1].value,
             **_row(row, _ENGAGEMENT)}
            for row in campaigns_r.rows
            if not row.dimension_values[0].value.startswith("(")
        ][:10]
        devices = [{"segment": row.dimension_values[0].value, **_row(row, _ENGAGEMENT)} for row in devices_r.rows]
        new_vs_returning = [
            {"segment": row.dimension_values[0].value, **_row(row, _ENGAGEMENT)}
            for row in nvr_r.rows
            if row.dimension_values[0].value in ("new", "returning")
        ]

        funnel_events, items = _ecommerce_detail(ga, prop, last7)

        result = {
            "currency": daily_r.metadata.currency_code or None,
            "time_zone": daily_r.metadata.time_zone or None,
            "daily": daily,
            "channels": channels,
            "campaigns": campaigns,
            "devices": devices,
            "new_vs_returning": new_vs_returning,
            "funnel_events": funnel_events,
            "items": items,
            "stale": False,
            "error": None,
        }
        with _lock:
            _cache[prop] = (time.time(), result)
        return result
    except Exception as e:  # noqa: BLE001 — any API failure falls back to the cache
        if cached:
            return {**cached[1], "stale": True}
        return {"daily": {}, "channels": [], "campaigns": [], "devices": [], "new_vs_returning": [],
                "funnel_events": None, "items": [], "currency": None,
                "time_zone": None, "stale": False, "error": str(e)}

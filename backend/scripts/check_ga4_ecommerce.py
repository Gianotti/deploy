"""Read-only check: which GA4 properties have ecommerce (purchase + revenue) data.

Uses the GA4 credentials stored in integration_configs and every client with a
ga4_property_id. Queries the last 30 days via the Data API (not Realtime).
Writes nothing.

Run inside the backend container (no redeploy needed):
    docker exec -i -w /app <backend-container> python - < backend/scripts/check_ga4_ecommerce.py
"""

from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    OrderBy,
    RunReportRequest,
)

from app.db.base import SessionLocal
import app.models  # noqa: F401 — registers all mappers so relationships resolve
from app.models.client import Client
from app.models.integration_config import IntegrationConfig
from app.services.ga4_service import get_ga4_client

RANGE = [DateRange(start_date="30daysAgo", end_date="yesterday")]


def main() -> None:
    db = SessionLocal()
    try:
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == "ga4_service_account").first()
        if not cfg:
            print("No GA4 credentials configured.")
            return
        clients = db.query(Client).filter(Client.ga4_property_id.isnot(None)).order_by(Client.name).all()
    finally:
        db.close()

    ga = get_ga4_client(cfg.value)
    print(f"{len(clients)} clients with a GA4 property — last 30 days\n")

    for c in clients:
        prop = c.ga4_property_id if c.ga4_property_id.startswith("properties/") else f"properties/{c.ga4_property_id}"
        print(f"== {c.name} ({prop})")
        try:
            r = ga.run_report(RunReportRequest(
                property=prop,
                date_ranges=RANGE,
                metrics=[Metric(name=m) for m in
                         ("activeUsers", "sessions", "keyEvents", "ecommercePurchases", "purchaseRevenue")],
            ))
            v = [x.value for x in r.rows[0].metric_values] if r.rows else ["0"] * 5
            cur = r.metadata.currency_code or "?"
            print(f"   users={v[0]}  sessions={v[1]}  keyEvents={v[2]}  purchases={v[3]}  revenue={v[4]} {cur}")

            ev = ga.run_report(RunReportRequest(
                property=prop,
                date_ranges=RANGE,
                dimensions=[Dimension(name="eventName")],
                metrics=[Metric(name="eventCount"), Metric(name="keyEvents")],
                order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="eventCount"), desc=True)],
                limit=25,
            ))
            keys = [f"{row.dimension_values[0].value}({row.metric_values[1].value})"
                    for row in ev.rows if row.metric_values[1].value not in ("0", "")]
            ecom = [f"{row.dimension_values[0].value}={row.metric_values[0].value}"
                    for row in ev.rows if row.dimension_values[0].value in
                    ("purchase", "begin_checkout", "add_to_cart", "view_item", "add_payment_info")]
            print(f"   key events: {', '.join(keys) or '-'}")
            print(f"   ecommerce events: {', '.join(ecom) or '-'}")
        except Exception as e:  # noqa: BLE001 — diagnostic script, report and continue
            print(f"   ERROR: {type(e).__name__}: {str(e)[:200]}")
        print()


main()

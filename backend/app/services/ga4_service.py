"""Integración con Google Analytics 4 Data API (Realtime).

Soporta dos métodos de autenticación:
  1. Service Account JSON  — requiere que el SA esté agregado en GA4 como Viewer
  2. OAuth Refresh Token   — usa credenciales de una cuenta que ya tiene acceso a GA4
"""

import json

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunRealtimeReportRequest,
    Dimension,
    Metric,
)
from google.oauth2 import service_account, credentials as oauth2_credentials
from google.auth.transport.requests import Request

GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]


def _client_from_service_account(credentials_json: str) -> BetaAnalyticsDataClient:
    info = json.loads(credentials_json)
    creds = service_account.Credentials.from_service_account_info(info, scopes=GA4_SCOPES)
    return BetaAnalyticsDataClient(credentials=creds)


def _client_from_oauth(credentials_json: str) -> BetaAnalyticsDataClient:
    """
    credentials_json debe tener la forma:
    {
      "type": "oauth",
      "client_id": "...",
      "client_secret": "...",
      "refresh_token": "..."
    }
    """
    info = json.loads(credentials_json)
    creds = oauth2_credentials.Credentials(
        token=None,
        refresh_token=info["refresh_token"],
        client_id=info["client_id"],
        client_secret=info["client_secret"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=GA4_SCOPES,
    )
    creds.refresh(Request())
    return BetaAnalyticsDataClient(credentials=creds)


def get_ga4_client(credentials_json: str) -> BetaAnalyticsDataClient:
    info = json.loads(credentials_json)
    if info.get("type") == "oauth":
        return _client_from_oauth(credentials_json)
    return _client_from_service_account(credentials_json)


def get_active_users(credentials_json: str, property_id: str) -> dict:
    if not property_id.startswith("properties/"):
        property_id = f"properties/{property_id}"

    ga4 = get_ga4_client(credentials_json)

    country_resp = ga4.run_realtime_report(RunRealtimeReportRequest(
        property=property_id,
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="activeUsers"), Metric(name="screenPageViews")],
    ))

    total_users = 0
    total_views = 0
    by_country: dict[str, int] = {}
    for row in country_resp.rows:
        country = row.dimension_values[0].value
        users = int(row.metric_values[0].value)
        views = int(row.metric_values[1].value)
        total_users += users
        total_views += views
        by_country[country] = users

    pages_resp = ga4.run_realtime_report(RunRealtimeReportRequest(
        property=property_id,
        dimensions=[Dimension(name="unifiedScreenName")],
        metrics=[Metric(name="activeUsers")],
        limit=3,
    ))
    top_pages = [
        {"path": row.dimension_values[0].value, "users": int(row.metric_values[0].value)}
        for row in pages_resp.rows
    ]

    return {
        "active_users": total_users,
        "page_views": total_views,
        "by_country": by_country,
        "top_pages": top_pages,
    }

"""Integración con Google Analytics 4 Data API (Realtime).

Soporta dos métodos de autenticación:
  1. Service Account JSON  — requiere que el SA esté agregado en GA4 como Viewer
  2. OAuth Refresh Token   — usa credenciales de una cuenta que ya tiene acceso a GA4
"""

import json
import threading
import time

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunRealtimeReportRequest,
    Dimension,
    Metric,
)
from google.oauth2 import service_account, credentials as oauth2_credentials
from google.auth.transport.requests import Request

GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

# ── Cache de clientes ─────────────────────────────────────────────────────────
# Evita crear un cliente nuevo por cada property en cada refresh.
# Para OAuth: reutiliza las credenciales y solo refresca el token cuando expira,
# en lugar de llamar a creds.refresh() N veces en paralelo (que causa errores).

_lock = threading.Lock()
_sa_client: BetaAnalyticsDataClient | None = None
_sa_creds_key: str | None = None          # hash de las credenciales SA actuales

_oauth_creds: oauth2_credentials.Credentials | None = None
_oauth_creds_key: str | None = None       # hash de las credenciales OAuth actuales

# Cache de resultados por property_id  →  (timestamp, data)
# Evita quota excedida en refreshes rápidos y sirve datos previos ante errores transitorios.
_result_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 45  # segundos


def _client_from_service_account(credentials_json: str) -> BetaAnalyticsDataClient:
    global _sa_client, _sa_creds_key
    with _lock:
        if _sa_creds_key != credentials_json or _sa_client is None:
            info = json.loads(credentials_json)
            creds = service_account.Credentials.from_service_account_info(info, scopes=GA4_SCOPES)
            _sa_client = BetaAnalyticsDataClient(credentials=creds)
            _sa_creds_key = credentials_json
        return _sa_client


def _client_from_oauth(credentials_json: str) -> BetaAnalyticsDataClient:
    """
    credentials_json debe tener la forma:
    {
      "type": "oauth",
      "client_id": "...",
      "client_secret": "...",
      "refresh_token": "..."
    }
    El token de acceso se refresca automáticamente cuando expira.
    Solo un thread a la vez puede refrescar (evita llamadas paralelas al endpoint OAuth).
    """
    global _oauth_creds, _oauth_creds_key
    with _lock:
        if _oauth_creds_key != credentials_json or _oauth_creds is None:
            info = json.loads(credentials_json)
            _oauth_creds = oauth2_credentials.Credentials(
                token=None,
                refresh_token=info["refresh_token"],
                client_id=info["client_id"],
                client_secret=info["client_secret"],
                token_uri="https://oauth2.googleapis.com/token",
                scopes=GA4_SCOPES,
            )
            _oauth_creds_key = credentials_json

        if not _oauth_creds.valid:
            _oauth_creds.refresh(Request())

        return BetaAnalyticsDataClient(credentials=_oauth_creds)


def get_ga4_client(credentials_json: str) -> BetaAnalyticsDataClient:
    info = json.loads(credentials_json)
    if info.get("type") == "oauth":
        return _client_from_oauth(credentials_json)
    return _client_from_service_account(credentials_json)


def get_active_users(credentials_json: str, property_id: str) -> dict:
    if not property_id.startswith("properties/"):
        property_id = f"properties/{property_id}"

    now = time.time()
    cached = _result_cache.get(property_id)

    # Devuelve cache si es reciente
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
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

        data = {
            "active_users": total_users,
            "page_views": total_views,
            "by_country": by_country,
            "top_pages": top_pages,
        }
        _result_cache[property_id] = (now, data)
        return data

    except Exception:
        # Ante cualquier error transitorio (quota, red, token temporal),
        # devuelve el último dato conocido si existe — sin mostrar error al usuario.
        if cached:
            return cached[1]
        raise

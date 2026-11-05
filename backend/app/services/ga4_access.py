"""Quién tiene acceso a cada property de GA4 y con qué rol.

Usa la GA4 Admin API (REST, `accessBindings`) con las mismas credenciales guardadas
para la Data API. Requisitos:
  - Service Account: tiene que tener rol Administrador en la property/cuenta de GA4
    (listar accesos es una acción de admin).
  - OAuth: el refresh token tiene que incluir el scope
    https://www.googleapis.com/auth/analytics.manage.users.readonly

La parte pura (merge_access, ROLE_LABELS, to_csv_rows) no hace I/O y está testeada.
"""

import json
import threading
import time

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import credentials as oauth2_credentials
from google.oauth2 import service_account

ADMIN_SCOPES = ["https://www.googleapis.com/auth/analytics.manage.users.readonly"]
_BASE = "https://analyticsadmin.googleapis.com"

# Rol predefinido → (etiqueta, nivel). Nivel mayor = más permisos.
ROLE_LABELS: dict[str, tuple[str, int]] = {
    "predefinedRoles/viewer": ("Lector", 1),
    "predefinedRoles/analyst": ("Analista", 2),
    "predefinedRoles/marketer": ("Marketer", 3),
    "predefinedRoles/editor": ("Editor", 4),
    "predefinedRoles/admin": ("Administrador", 5),
}
# Restricciones de datos: no son un rol de acceso, se muestran aparte.
RESTRICTION_LABELS: dict[str, str] = {
    "predefinedRoles/no-cost-data": "Sin datos de costos",
    "predefinedRoles/no-revenue-data": "Sin datos de ingresos",
}


def role_label(role: str) -> str:
    if role in ROLE_LABELS:
        return ROLE_LABELS[role][0]
    if role in RESTRICTION_LABELS:
        return RESTRICTION_LABELS[role]
    return role.split("/")[-1]


def _best_role(roles: list[str]) -> str | None:
    ranked = [r for r in roles if r in ROLE_LABELS]
    if not ranked:
        return None
    return max(ranked, key=lambda r: ROLE_LABELS[r][1])


def merge_access(property_bindings: list[dict], account_bindings: list[dict]) -> list[dict]:
    """Une los accesos de la property y los heredados de la cuenta, uno por email.

    Cada binding es la forma de la API: {"user": "a@b.com", "roles": ["predefinedRoles/viewer"]}.
    (Los bindings de grupos/otros principals sin `user` se ignoran.)
    El rol efectivo es el más alto entre property y cuenta; las restricciones de datos se suman.
    Orden: rol efectivo desc, luego email.
    """
    users: dict[str, dict] = {}

    def add(bindings: list[dict], level: str):
        for b in bindings:
            email = (b.get("user") or "").strip().lower()
            if not email:
                continue
            u = users.setdefault(email, {"email": email, "property_roles": [], "account_roles": []})
            u[f"{level}_roles"].extend(r for r in b.get("roles", []) if r not in u[f"{level}_roles"])

    add(property_bindings, "property")
    add(account_bindings, "account")

    out = []
    for u in users.values():
        all_roles = u["property_roles"] + u["account_roles"]
        best = _best_role(all_roles)
        restrictions = sorted({r for r in all_roles if r in RESTRICTION_LABELS})
        if u["property_roles"] and u["account_roles"]:
            source = "property+account"
        elif u["account_roles"]:
            source = "account"
        else:
            source = "property"
        out.append({
            "email": u["email"],
            "role": role_label(best) if best else "—",
            "role_level": ROLE_LABELS[best][1] if best else 0,
            "property_roles": [role_label(r) for r in u["property_roles"] if r in ROLE_LABELS],
            "account_roles": [role_label(r) for r in u["account_roles"] if r in ROLE_LABELS],
            "restrictions": [RESTRICTION_LABELS[r] for r in restrictions],
            "source": source,
        })
    out.sort(key=lambda u: (-u["role_level"], u["email"]))
    return out


# ── I/O ───────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_session: AuthorizedSession | None = None
_session_key: str | None = None

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 600  # 10 min: los accesos cambian poco y la Admin API tiene quota baja


def _get_session(credentials_json: str) -> AuthorizedSession:
    global _session, _session_key
    with _lock:
        if _session is None or _session_key != credentials_json:
            info = json.loads(credentials_json)
            if info.get("type") == "oauth":
                creds = oauth2_credentials.Credentials(
                    token=None,
                    refresh_token=info["refresh_token"],
                    client_id=info["client_id"],
                    client_secret=info["client_secret"],
                    token_uri="https://oauth2.googleapis.com/token",
                    scopes=ADMIN_SCOPES,
                )
            else:
                creds = service_account.Credentials.from_service_account_info(info, scopes=ADMIN_SCOPES)
            _session = AuthorizedSession(creds)
            _session_key = credentials_json
        return _session


def _get(session: AuthorizedSession, path: str, params: dict | None = None) -> dict:
    resp = session.get(f"{_BASE}{path}", params=params, timeout=20)
    if resp.status_code >= 400:
        try:
            err = resp.json().get("error", {})
            msg = err.get("message") or resp.text
        except Exception:
            msg = resp.text
        raise RuntimeError(f"{resp.status_code} {msg}")
    return resp.json()


def _list_bindings(session: AuthorizedSession, parent: str) -> list[dict]:
    out: list[dict] = []
    token = None
    while True:
        params = {"pageSize": 500}
        if token:
            params["pageToken"] = token
        data = _get(session, f"/v1alpha/{parent}/accessBindings", params)
        out.extend(data.get("accessBindings", []))
        token = data.get("nextPageToken")
        if not token:
            return out


def get_property_access(credentials_json: str, property_id: str, force: bool = False) -> dict:
    """Devuelve {property_id, property_name, account, account_name, users, account_error}.

    Si falla la lectura de la cuenta (p. ej. sin admin a nivel cuenta) se devuelven solo
    los accesos de la property y el error en `account_error`. Un error en la property se propaga.
    """
    pid = property_id.strip()
    if not pid.startswith("properties/"):
        pid = f"properties/{pid}"

    now = time.time()
    cached = _cache.get(pid)
    if not force and cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    session = _get_session(credentials_json)
    prop = _get(session, f"/v1beta/{pid}")
    account = prop.get("parent")  # "accounts/123"

    property_bindings = _list_bindings(session, pid)

    account_bindings: list[dict] = []
    account_error = None
    account_name = None
    if account:
        try:
            account_name = _get(session, f"/v1beta/{account}").get("displayName")
            account_bindings = _list_bindings(session, account)
        except Exception as e:
            account_error = str(e)[:200]

    result = {
        "property_id": pid,
        "property_name": prop.get("displayName"),
        "account": account,
        "account_name": account_name,
        "users": merge_access(property_bindings, account_bindings),
        "account_error": account_error,
    }
    _cache[pid] = (now, result)
    return result

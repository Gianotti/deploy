import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.models.integration_config import IntegrationConfig
from app.services.ga4_service import get_active_users

router = APIRouter(prefix="/ga4", tags=["ga4"])

GA4_CREDS_KEY = "ga4_service_account"


class GA4CredsIn(BaseModel):
    credentials_json: str


class GA4RealtimeOut(BaseModel):
    client_id: int
    client_name: str
    property_id: str
    active_users: int       # -1 = error
    page_views: int
    conversions: int = 0
    top_pages: list[dict] = []
    traffic_sources: dict[str, int] = {}
    device_breakdown: dict[str, int] = {}
    top_events: list[dict] = []
    new_vs_returning: dict[str, int] = {}
    error: str | None = None


def _get_creds(db: Session) -> str | None:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == GA4_CREDS_KEY).first()
    return cfg.value if cfg else None


def _friendly_error(e: Exception) -> str:
    msg = str(e)
    if "403" in msg or "permission" in msg.lower():
        return "Sin acceso a esta propiedad — verificá que el SA/cuenta tenga rol Viewer en GA4"
    if "404" in msg or "not found" in msg.lower():
        return "Property ID no encontrado — verificá el número en GA4 → Admin → Property Settings"
    if "429" in msg or "quota" in msg.lower() or "resource_exhausted" in msg.lower():
        return "Quota de la API excedida — esperá unos segundos y refrescá"
    if "invalid_grant" in msg:
        return "Token expirado o inválido — regenerá el Refresh Token en el OAuth Playground"
    return f"Error de API: {msg[:120]}"


@router.post("/credentials", dependencies=[Depends(require_admin)])
def save_credentials(payload: GA4CredsIn, db: Session = Depends(get_db)):
    try:
        json.loads(payload.credentials_json)
    except Exception:
        raise HTTPException(400, "El JSON proporcionado no es válido")

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == GA4_CREDS_KEY).first()
    if cfg:
        cfg.value = payload.credentials_json
    else:
        cfg = IntegrationConfig(key=GA4_CREDS_KEY, value=payload.credentials_json)
        db.add(cfg)
    db.commit()
    return {"saved": True}


@router.get("/credentials/status")
def credentials_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = _get_creds(db)
    if not creds:
        return {"configured": False}
    info = json.loads(creds)
    # Para OAuth mostramos el tipo; para SA mostramos el email
    if info.get("type") == "oauth":
        return {"configured": True, "client_email": f"OAuth — client_id: {info.get('client_id','')[:30]}..."}
    return {"configured": True, "client_email": info.get("client_email", "unknown")}


@router.delete("/credentials", dependencies=[Depends(require_admin)])
def delete_credentials(db: Session = Depends(get_db)):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == GA4_CREDS_KEY).first()
    if cfg:
        db.delete(cfg)
        db.commit()
    return {"deleted": True}


@router.get("/realtime", response_model=list[GA4RealtimeOut])
def get_realtime_all(db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = _get_creds(db)
    if not creds:
        raise HTTPException(400, "No hay credenciales de GA4 configuradas. Configuralas en Admin → GA4.")

    clients = db.query(Client).filter(Client.ga4_property_id.isnot(None)).all()
    results = []

    for client in clients:
        try:
            data = get_active_users(creds, client.ga4_property_id)
            results.append(GA4RealtimeOut(
                client_id=client.id,
                client_name=client.name,
                property_id=client.ga4_property_id,
                **data,
            ))
        except Exception as e:
            results.append(GA4RealtimeOut(
                client_id=client.id,
                client_name=client.name,
                property_id=client.ga4_property_id,
                active_users=-1,
                page_views=0,
                traffic_sources={},
                error=_friendly_error(e),
            ))

    return results


@router.get("/realtime/{client_id}", response_model=GA4RealtimeOut)
def get_realtime_client(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = _get_creds(db)
    if not creds:
        raise HTTPException(400, "No hay credenciales de GA4 configuradas")

    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    if not client.ga4_property_id:
        raise HTTPException(400, f"El cliente '{client.name}' no tiene GA4 property ID configurado")

    try:
        data = get_active_users(creds, client.ga4_property_id)
        return GA4RealtimeOut(
            client_id=client.id,
            client_name=client.name,
            property_id=client.ga4_property_id,
            **data,
        )
    except Exception as e:
        raise HTTPException(502, _friendly_error(e))

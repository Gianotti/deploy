import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.models.integration_config import IntegrationConfig
from app.services import cloudflare_service as cf

router = APIRouter(prefix="/cloudflare", tags=["cloudflare"])

CF_CREDS_KEY = "cloudflare"


class CloudflareCredsIn(BaseModel):
    account_id: str
    api_token: str


def get_cf_creds(db: Session) -> dict | None:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == CF_CREDS_KEY).first()
    return json.loads(cfg.value) if cfg else None


@router.post("/credentials", dependencies=[Depends(require_admin)])
def save_credentials(payload: CloudflareCredsIn, db: Session = Depends(get_db)):
    account_id, token = payload.account_id.strip(), payload.api_token.strip()
    try:
        ok = cf.verify_token(account_id, token)
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(400, "Cloudflare rechazó el token — revisá el Account ID y que el token esté activo")

    value = json.dumps({"account_id": account_id, "api_token": token})
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == CF_CREDS_KEY).first()
    if cfg:
        cfg.value = value
    else:
        db.add(IntegrationConfig(key=CF_CREDS_KEY, value=value))
    db.commit()
    return {"saved": True}


@router.get("/credentials/status")
def credentials_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = get_cf_creds(db)
    if not creds:
        return {"configured": False}
    # Nunca devolvemos el token
    return {"configured": True, "account_id": creds["account_id"]}


@router.delete("/credentials", dependencies=[Depends(require_admin)])
def delete_credentials(db: Session = Depends(get_db)):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == CF_CREDS_KEY).first()
    if cfg:
        db.delete(cfg)
        db.commit()
    return {"deleted": True}


@router.get("/zones")
def zones(db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = get_cf_creds(db)
    if not creds:
        raise HTTPException(400, "No hay credenciales de Cloudflare configuradas")
    try:
        return cf.list_zones(creds["account_id"], creds["api_token"])
    except Exception as e:
        raise HTTPException(502, f"Error de Cloudflare: {str(e)[:120]}")


@router.get("/traffic/{client_id}")
def client_traffic(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    creds = get_cf_creds(db)
    if not creds:
        raise HTTPException(400, "No hay credenciales de Cloudflare configuradas")
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    if not client.site_host:
        raise HTTPException(400, f"El cliente '{client.name}' no tiene dominio configurado")
    try:
        data = cf.get_bot_traffic(creds["account_id"], creds["api_token"], client.site_host)
    except Exception as e:
        raise HTTPException(502, f"Error de Cloudflare: {str(e)[:120]}")
    if data is None:
        raise HTTPException(404, f"Ninguna zona de Cloudflare contiene '{client.site_host}'")
    return data

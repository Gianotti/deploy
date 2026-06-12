from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.integration_config import IntegrationConfig
from app.models.notification_config import NotificationConfig
from app.scheduler import rebuild_notification_jobs
from app.services.google_chat import collect_client_statuses, build_status_message, send_to_webhook

BACKEND_URL_KEY = "backend_public_url"

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationConfigIn(BaseModel):
    webhook_url: str
    time_1: str | None = None
    time_2: str | None = None
    time_3: str | None = None
    is_active: bool = True


class NotificationConfigOut(NotificationConfigIn):
    id: int
    model_config = {"from_attributes": True}


def _get_or_create(db: Session) -> NotificationConfig:
    cfg = db.query(NotificationConfig).first()
    if not cfg:
        cfg = NotificationConfig(id=1, webhook_url="", is_active=False)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("/config", response_model=NotificationConfigOut)
def get_config(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _get_or_create(db)


@router.post("/config", response_model=NotificationConfigOut, dependencies=[Depends(require_admin)])
def save_config(payload: NotificationConfigIn, db: Session = Depends(get_db)):
    cfg = _get_or_create(db)
    for field, value in payload.model_dump().items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    # Reconstruir jobs con los nuevos horarios
    rebuild_notification_jobs(cfg.time_1, cfg.time_2, cfg.time_3)
    return cfg


@router.get("/backend-url", dependencies=[Depends(get_current_user)])
def get_backend_url(db: Session = Depends(get_db)):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == BACKEND_URL_KEY).first()
    return {"url": cfg.value if cfg else ""}


class BackendUrlIn(BaseModel):
    url: str


@router.post("/backend-url", dependencies=[Depends(require_admin)])
def save_backend_url(payload: BackendUrlIn, db: Session = Depends(get_db)):
    url = payload.url.strip().rstrip("/")
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.key == BACKEND_URL_KEY).first()
    if cfg:
        cfg.value = url
    else:
        db.add(IntegrationConfig(key=BACKEND_URL_KEY, value=url))
    db.commit()
    return {"url": url}


@router.post("/send-now", dependencies=[Depends(require_admin)])
def send_now(db: Session = Depends(get_db)):
    cfg = _get_or_create(db)
    if not cfg.webhook_url:
        raise HTTPException(400, "No hay webhook configurado")
    statuses = collect_client_statuses(db)
    msg = build_status_message(statuses)
    ok = send_to_webhook(cfg.webhook_url, msg)
    if not ok:
        raise HTTPException(502, "Error al enviar el mensaje al webhook")
    return {"sent": True, "message": msg}

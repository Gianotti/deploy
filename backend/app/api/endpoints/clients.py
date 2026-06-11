from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.schemas.client import ClientCreate, ClientOut, ClientUpdate

router = APIRouter(prefix="/clients", tags=["clients"])

_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}


def _out(c: Client) -> ClientOut:
    return ClientOut.from_orm_client(c)


@router.get("/", response_model=List[ClientOut])
def list_clients(country_id: int | None = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Client)
    if country_id:
        q = q.filter(Client.country_id == country_id)
    return [_out(c) for c in q.all()]


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    return _out(c)


@router.post("/", response_model=ClientOut, dependencies=[Depends(require_admin)])
def create_client(payload: ClientCreate, db: Session = Depends(get_db)):
    client = Client(**payload.model_dump())
    db.add(client)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Error al crear el cliente")
    db.refresh(client)
    return _out(client)


@router.patch("/{client_id}", response_model=ClientOut, dependencies=[Depends(require_admin)])
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return _out(c)


@router.delete("/{client_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    try:
        db.delete(c)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "No se puede eliminar: el cliente tiene promociones asociadas")


@router.post("/{client_id}/logo", response_model=ClientOut, dependencies=[Depends(require_admin)])
async def upload_logo(client_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"Tipo no permitido: {file.content_type}. Usá PNG, JPG, WEBP, GIF o SVG.")
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    data = await file.read()
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(400, "El logo no puede superar 4 MB")
    c.logo_data = data
    c.logo_filename = file.filename
    db.commit()
    db.refresh(c)
    return _out(c)


@router.delete("/{client_id}/logo", response_model=ClientOut, dependencies=[Depends(require_admin)])
def delete_logo(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    c.logo_data = None
    c.logo_filename = None
    db.commit()
    db.refresh(c)
    return _out(c)


@router.get("/{client_id}/logo")
def get_logo(client_id: int, db: Session = Depends(get_db)):
    """Sirve el logo del cliente (sin autenticación para usar en landing)."""
    c = db.get(Client, client_id)
    if not c or not c.logo_data:
        raise HTTPException(404, "Logo no encontrado")
    fname = (c.logo_filename or "").lower()
    if fname.endswith(".png"):
        media_type = "image/png"
    elif fname.endswith(".webp"):
        media_type = "image/webp"
    elif fname.endswith(".gif"):
        media_type = "image/gif"
    elif fname.endswith(".svg"):
        media_type = "image/svg+xml"
    else:
        media_type = "image/jpeg"
    return Response(content=c.logo_data, media_type=media_type)

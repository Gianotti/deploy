from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.schemas.client import ClientCreate, ClientOut, ClientUpdate

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("/", response_model=List[ClientOut])
def list_clients(country_id: int | None = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Client)
    if country_id:
        q = q.filter(Client.country_id == country_id)
    return q.all()


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    return c


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
    return client


@router.patch("/{client_id}", response_model=ClientOut, dependencies=[Depends(require_admin)])
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return c


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

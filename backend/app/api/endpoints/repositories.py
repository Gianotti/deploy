from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.client import Client
from app.models.repository import Repository
from app.schemas.repository import RepositoryCreate, RepositoryClientLink, RepositoryOut

router = APIRouter(prefix="/repositories", tags=["repositories"])


@router.get("/", response_model=list[RepositoryOut])
def list_repositories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Repository).all()


@router.post("/", response_model=RepositoryOut, dependencies=[Depends(require_admin)])
def create_repository(payload: RepositoryCreate, db: Session = Depends(get_db)):
    if db.query(Repository).filter(Repository.name == payload.name).first():
        raise HTTPException(400, "Ya existe un repositorio con ese nombre")
    repo = Repository(name=payload.name)
    db.add(repo)
    db.commit()
    db.refresh(repo)
    return repo


@router.delete("/{repo_id}", dependencies=[Depends(require_admin)])
def delete_repository(repo_id: int, db: Session = Depends(get_db)):
    repo = db.get(Repository, repo_id)
    if not repo:
        raise HTTPException(404, "Repositorio no encontrado")
    db.delete(repo)
    db.commit()
    return {"deleted": True}


@router.post("/{repo_id}/clients", response_model=RepositoryOut, dependencies=[Depends(require_admin)])
def add_client(repo_id: int, payload: RepositoryClientLink, db: Session = Depends(get_db)):
    repo = db.get(Repository, repo_id)
    if not repo:
        raise HTTPException(404, "Repositorio no encontrado")
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    if client in repo.clients:
        raise HTTPException(400, "El cliente ya está vinculado a este repositorio")
    repo.clients.append(client)
    db.commit()
    db.refresh(repo)
    return repo


@router.delete("/{repo_id}/clients/{client_id}", response_model=RepositoryOut, dependencies=[Depends(require_admin)])
def remove_client(repo_id: int, client_id: int, db: Session = Depends(get_db)):
    repo = db.get(Repository, repo_id)
    if not repo:
        raise HTTPException(404, "Repositorio no encontrado")
    client = db.get(Client, client_id)
    if not client or client not in repo.clients:
        raise HTTPException(404, "El cliente no está vinculado a este repositorio")
    repo.clients.remove(client)
    db.commit()
    db.refresh(repo)
    return repo

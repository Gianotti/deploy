from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.country import Country
from app.schemas.country import CountryCreate, CountryOut, CountryUpdate

router = APIRouter(prefix="/countries", tags=["countries"])


@router.get("/", response_model=List[CountryOut])
def list_countries(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Country).all()


@router.get("/{country_id}", response_model=CountryOut)
def get_country(country_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.get(Country, country_id)
    if not c:
        raise HTTPException(404, "Country not found")
    return c


@router.post("/", response_model=CountryOut, dependencies=[Depends(require_admin)])
def create_country(payload: CountryCreate, db: Session = Depends(get_db)):
    country = Country(**payload.model_dump())
    db.add(country)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f"El código ISO '{payload.iso_code}' ya existe")
    db.refresh(country)
    return country


@router.patch("/{country_id}", response_model=CountryOut, dependencies=[Depends(require_admin)])
def update_country(country_id: int, payload: CountryUpdate, db: Session = Depends(get_db)):
    c = db.get(Country, country_id)
    if not c:
        raise HTTPException(404, "Country not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{country_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_country(country_id: int, db: Session = Depends(get_db)):
    c = db.get(Country, country_id)
    if not c:
        raise HTTPException(404, "Country not found")
    try:
        db.delete(c)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "No se puede eliminar: el país tiene clientes asociados")

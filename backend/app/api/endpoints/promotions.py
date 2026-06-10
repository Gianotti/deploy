from typing import List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin, require_admin_or_comercial
from app.db.base import get_db
from app.models.promotion import Promotion
from app.schemas.promotion import PromotionCreate, PromotionOut, PromotionUpdate

router = APIRouter(prefix="/promotions", tags=["promotions"])


@router.get("/", response_model=List[PromotionOut])
def list_promotions(
    client_id: int | None = None,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Promotion)
    if client_id:
        q = q.filter(Promotion.client_id == client_id)
    if from_date:
        q = q.filter(Promotion.end_date >= from_date)
    if to_date:
        q = q.filter(Promotion.start_date <= to_date)
    return q.all()


@router.get("/{promotion_id}", response_model=PromotionOut)
def get_promotion(promotion_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    p = db.get(Promotion, promotion_id)
    if not p:
        raise HTTPException(404, "Promotion not found")
    return p


@router.post("/", response_model=PromotionOut, dependencies=[Depends(require_admin_or_comercial)])
def create_promotion(payload: PromotionCreate, db: Session = Depends(get_db)):
    promo = Promotion(**payload.model_dump())
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo


@router.patch("/{promotion_id}", response_model=PromotionOut, dependencies=[Depends(require_admin)])
def update_promotion(promotion_id: int, payload: PromotionUpdate, db: Session = Depends(get_db)):
    p = db.get(Promotion, promotion_id)
    if not p:
        raise HTTPException(404, "Promotion not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{promotion_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_promotion(promotion_id: int, db: Session = Depends(get_db)):
    p = db.get(Promotion, promotion_id)
    if not p:
        raise HTTPException(404, "Promotion not found")
    db.delete(p)
    db.commit()

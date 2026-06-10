from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.deploy_rule import DeployRule
from app.schemas.deploy_rule import DeployRuleCreate, DeployRuleOut, DeployRuleUpdate

router = APIRouter(prefix="/deploy-rules", tags=["deploy-rules"])


@router.get("/", response_model=List[DeployRuleOut])
def list_rules(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(DeployRule).all()


@router.post("/", response_model=DeployRuleOut, dependencies=[Depends(require_admin)])
def create_rule(payload: DeployRuleCreate, db: Session = Depends(get_db)):
    rule = DeployRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=DeployRuleOut, dependencies=[Depends(require_admin)])
def update_rule(rule_id: int, payload: DeployRuleUpdate, db: Session = Depends(get_db)):
    r = db.get(DeployRule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{rule_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    r = db.get(DeployRule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    db.delete(r)
    db.commit()

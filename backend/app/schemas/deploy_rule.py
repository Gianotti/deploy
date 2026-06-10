from pydantic import BaseModel
from app.models.promotion import PromoType
from app.models.deploy_rule import DeployStatus


class DeployRuleBase(BaseModel):
    promo_type: PromoType
    min_criticality: int = 1
    deploy_status: DeployStatus
    window_start: str | None = None  # "HH:MM"
    window_end: str | None = None    # "HH:MM"
    description: str | None = None


class DeployRuleCreate(DeployRuleBase):
    pass


class DeployRuleUpdate(BaseModel):
    min_criticality: int | None = None
    deploy_status: DeployStatus | None = None
    window_start: str | None = None
    window_end: str | None = None
    description: str | None = None


class DeployRuleOut(DeployRuleBase):
    id: int

    model_config = {"from_attributes": True}

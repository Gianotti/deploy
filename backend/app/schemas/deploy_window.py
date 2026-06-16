from datetime import date
from typing import List
from pydantic import BaseModel
from app.models.deploy_rule import DeployStatus
from app.schemas.promotion import PromotionOut


class DeployWindowDay(BaseModel):
    date: date
    deploy_status: DeployStatus
    window_start: str | None  # local time "HH:MM"
    window_end: str | None
    active_promotions: List[PromotionOut]


class DeployWindowResponse(BaseModel):
    client_id: int
    country_id: int
    windows: List[DeployWindowDay]


class TodayStatusResponse(BaseModel):
    client_id: int
    date: date
    deploy_status: DeployStatus
    window_start: str | None
    window_end: str | None
    can_deploy_now: bool
    active_promotions: List[PromotionOut]
    message: str
    traffic_blocked: bool = False
    user_threshold: int | None = None

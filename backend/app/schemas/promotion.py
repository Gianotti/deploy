from datetime import date
from pydantic import BaseModel, model_validator
from app.models.promotion import PromoType


class PromotionBase(BaseModel):
    client_id: int
    start_date: date
    end_date: date
    promo_type: PromoType
    criticality: int = 1
    description: str | None = None

    @model_validator(mode="after")
    def end_after_start(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        if not (1 <= self.criticality <= 5):
            raise ValueError("criticality must be between 1 and 5")
        return self


class PromotionCreate(PromotionBase):
    pass


class PromotionUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    promo_type: PromoType | None = None
    criticality: int | None = None
    description: str | None = None


class PromotionOut(PromotionBase):
    id: int

    model_config = {"from_attributes": True}

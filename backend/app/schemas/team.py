from pydantic import BaseModel


class TeamChannelIn(BaseModel):
    webhook_url: str
    label: str | None = None


class TeamChannelOut(TeamChannelIn):
    id: int
    model_config = {"from_attributes": True}


class TeamNotificationSlotIn(BaseModel):
    slot_number: int   # 1, 2, or 3
    time: str | None = None
    message: str | None = None


class TeamNotificationSlotOut(TeamNotificationSlotIn):
    id: int
    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str
    deploy_days: list[int] = []   # 0=Mon … 6=Sun


class TeamUpdate(BaseModel):
    name: str | None = None
    deploy_days: list[int] | None = None


class TeamOut(BaseModel):
    id: int
    name: str
    deploy_days: list[int]
    channels: list[TeamChannelOut] = []
    slots: list[TeamNotificationSlotOut] = []
    model_config = {"from_attributes": True}

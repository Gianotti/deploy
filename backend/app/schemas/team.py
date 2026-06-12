from pydantic import BaseModel


class TeamChannelIn(BaseModel):
    webhook_url: str
    label: str | None = None


class TeamChannelOut(TeamChannelIn):
    id: int
    model_config = {"from_attributes": True}


class TeamNotificationSlotIn(BaseModel):
    sort_order: int = 0
    time: str | None = None
    message_ok: str | None = None
    message_blocked: str | None = None


class TeamNotificationSlotOut(TeamNotificationSlotIn):
    id: int
    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_slot(cls, slot) -> "TeamNotificationSlotOut":
        return cls(
            id=slot.id,
            sort_order=slot.sort_order,
            time=slot.time,
            message_ok=slot.message_ok,
            message_blocked=slot.message_blocked,
        )


class TeamCreate(BaseModel):
    name: str
    deploy_days: list[int] = []


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

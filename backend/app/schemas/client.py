from pydantic import BaseModel
from app.schemas.country import CountryOut


class ClientBase(BaseModel):
    name: str
    country_id: int
    ga4_property_id: str | None = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    country_id: int | None = None
    ga4_property_id: str | None = None


class ClientOut(ClientBase):
    id: int
    country: CountryOut

    model_config = {"from_attributes": True}

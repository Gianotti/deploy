from pydantic import BaseModel
from app.schemas.country import CountryOut


class ClientBase(BaseModel):
    name: str
    country_id: int
    ga4_property_id: str | None = None
    user_threshold: int | None = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    country_id: int | None = None
    ga4_property_id: str | None = None
    user_threshold: int | None = None


class ClientOut(ClientBase):
    id: int
    country: CountryOut
    has_logo: bool = False
    logo_filename: str | None = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_client(cls, c) -> "ClientOut":
        return cls(
            id=c.id,
            name=c.name,
            country_id=c.country_id,
            ga4_property_id=c.ga4_property_id,
            user_threshold=c.user_threshold,
            country=c.country,
            has_logo=c.logo_data is not None,
            logo_filename=c.logo_filename,
        )

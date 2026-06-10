from pydantic import BaseModel


class CountryBase(BaseModel):
    name: str
    iso_code: str
    timezone: str


class CountryCreate(CountryBase):
    pass


class CountryUpdate(BaseModel):
    name: str | None = None
    timezone: str | None = None


class CountryOut(CountryBase):
    id: int

    model_config = {"from_attributes": True}

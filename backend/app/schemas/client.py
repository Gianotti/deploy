import re

from pydantic import BaseModel, field_validator
from app.schemas.country import CountryOut


def split_hosts(text: str | None) -> list[str]:
    """Stored newline-separated `api_hosts` -> list."""
    return [h for h in (text or "").split("\n") if h.strip()]


def clean_hosts(v) -> list[str]:
    """Hosts typed one per line or comma-separated -> normalized, deduped, in order."""
    from app.services.cloudflare_service import normalize_host

    items = re.split(r"[\s,;]+", v) if isinstance(v, str) else list(v or [])
    out: list[str] = []
    for raw in items:
        h = normalize_host(str(raw))
        if not h:
            continue
        if "." not in h or not re.fullmatch(r"[a-z0-9.-]+", h):
            raise ValueError(f"Host inválido: {raw}")
        if h not in out:
            out.append(h)
    return out


class ClientBase(BaseModel):
    name: str
    country_id: int
    ga4_property_id: str | None = None
    user_threshold: int | None = None
    site_host: str | None = None
    api_hosts: list[str] = []

    @field_validator("api_hosts", mode="before")
    @classmethod
    def _hosts(cls, v):
        return clean_hosts(v)


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    country_id: int | None = None
    ga4_property_id: str | None = None
    user_threshold: int | None = None
    site_host: str | None = None
    api_hosts: list[str] | None = None

    @field_validator("api_hosts", mode="before")
    @classmethod
    def _hosts(cls, v):
        return None if v is None else clean_hosts(v)


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
            site_host=c.site_host,
            api_hosts=split_hosts(c.api_hosts),
            country=c.country,
            has_logo=c.logo_data is not None,
            logo_filename=c.logo_filename,
        )

from pydantic import BaseModel, field_validator

from app.services.integrators import normalize_ip


class IntegratorIPIn(BaseModel):
    ip: str
    label: str | None = None

    @field_validator("ip")
    @classmethod
    def _ip(cls, v: str) -> str:
        return normalize_ip(v)

    @field_validator("label")
    @classmethod
    def _label(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class IntegratorIn(BaseModel):
    name: str
    notes: str | None = None
    active: bool = True
    ips: list[IntegratorIPIn] = []
    client_ids: list[int] = []

    @field_validator("client_ids")
    @classmethod
    def _dedupe(cls, v: list[int]) -> list[int]:
        return list(dict.fromkeys(v))

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El nombre es obligatorio")
        return v

    @field_validator("ips")
    @classmethod
    def _unique(cls, v: list[IntegratorIPIn]) -> list[IntegratorIPIn]:
        seen = set()
        for x in v:
            if x.ip in seen:
                raise ValueError(f"La IP {x.ip} está repetida")
            seen.add(x.ip)
        return v


class IntegratorIPOut(BaseModel):
    id: int
    ip: str
    label: str | None = None
    model_config = {"from_attributes": True}


class IntegratorClientOut(BaseModel):
    id: int
    name: str
    site_host: str | None = None
    model_config = {"from_attributes": True}


class IntegratorOut(BaseModel):
    id: int
    name: str
    notes: str | None = None
    active: bool
    ips: list[IntegratorIPOut] = []
    clients: list[IntegratorClientOut] = []
    model_config = {"from_attributes": True}

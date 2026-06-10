from pydantic import BaseModel


class RepositoryCreate(BaseModel):
    name: str


class RepositoryClientLink(BaseModel):
    client_id: int


class ClientSummary(BaseModel):
    id: int
    name: str
    model_config = {"from_attributes": True}


class RepositoryOut(BaseModel):
    id: int
    name: str
    clients: list[ClientSummary] = []
    model_config = {"from_attributes": True}

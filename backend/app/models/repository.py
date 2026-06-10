from sqlalchemy import Column, Integer, String, Table, ForeignKey
from sqlalchemy.orm import relationship

from app.db.base import Base

client_repositories = Table(
    "client_repositories",
    Base.metadata,
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
    Column("repository_id", Integer, ForeignKey("repositories.id", ondelete="CASCADE"), primary_key=True),
)


class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    clients = relationship("Client", secondary=client_repositories, back_populates="repositories")

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.db.base import Base


class Country(Base):
    __tablename__ = "countries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    iso_code = Column(String(3), unique=True, nullable=False, index=True)
    timezone = Column(String, nullable=False)  # e.g. "America/Argentina/Buenos_Aires"

    clients = relationship("Client", back_populates="country")

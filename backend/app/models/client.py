from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from app.db.base import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=False)
    ga4_property_id = Column(String, nullable=True)  # e.g. "properties/123456789"

    country = relationship("Country", back_populates="clients")
    promotions = relationship("Promotion", back_populates="client")

from sqlalchemy import Column, Integer, String, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship

from app.db.base import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=False)
    ga4_property_id = Column(String, nullable=True)
    user_threshold = Column(Integer, nullable=True)  # block deploy if active users >= this
    logo_data = Column(LargeBinary, nullable=True)
    logo_filename = Column(String, nullable=True)

    country = relationship("Country", back_populates="clients")
    promotions = relationship("Promotion", back_populates="client")
    repositories = relationship("Repository", secondary="client_repositories", back_populates="clients")

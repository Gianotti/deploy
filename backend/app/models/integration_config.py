from sqlalchemy import Column, Integer, String, Text
from app.db.base import Base


class IntegrationConfig(Base):
    """Pares clave/valor para credenciales de integraciones externas."""
    __tablename__ = "integration_configs"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False)  # e.g. "ga4_service_account"
    value = Column(Text, nullable=False)

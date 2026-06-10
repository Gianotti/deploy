import enum
from sqlalchemy import Column, Integer, String, Date, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship

from app.db.base import Base


class PromoType(str, enum.Enum):
    PROMO_ESPECIAL = "PROMO_ESPECIAL"  # bloquea todo el día
    PROMO_NORMAL = "PROMO_NORMAL"      # permite deploy con aviso


class Promotion(Base):
    __tablename__ = "promotions"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    promo_type = Column(SAEnum(PromoType), nullable=False)
    # criticality 1 (low) to 5 (critical)
    criticality = Column(Integer, nullable=False, default=1)
    description = Column(String, nullable=True)

    client = relationship("Client", back_populates="promotions")

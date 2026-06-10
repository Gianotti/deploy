import enum
from sqlalchemy import Column, Integer, String, Time, Enum as SAEnum
from sqlalchemy.dialects.postgresql import ARRAY

from app.db.base import Base
from app.models.promotion import PromoType


class DeployStatus(str, enum.Enum):
    LIBRE = "LIBRE"
    RESTRINGIDO = "RESTRINGIDO"
    BLOQUEADO = "BLOQUEADO"


class DeployRule(Base):
    """
    Maps a (promo_type, min_criticality) combination to a deploy status and
    optional allowed time window (stored as HH:MM strings in local time).
    Rules are evaluated from most-restrictive to least-restrictive;
    the engine picks the worst result across all active promotions.
    """
    __tablename__ = "deploy_rules"

    id = Column(Integer, primary_key=True, index=True)
    promo_type = Column(SAEnum(PromoType), nullable=False)
    # Rule applies when promotion criticality >= min_criticality
    min_criticality = Column(Integer, nullable=False, default=1)
    deploy_status = Column(SAEnum(DeployStatus), nullable=False)
    # Allowed window in local time — null means "all day" (or "no window" if BLOQUEADO)
    window_start = Column(String(5), nullable=True)  # "HH:MM"
    window_end = Column(String(5), nullable=True)    # "HH:MM"
    description = Column(String, nullable=True)

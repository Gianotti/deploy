from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.base import Base


class Integrator(Base):
    """A third party (e.g. Sincroshop) that calls our sites' APIs from known IPs.
    Its traffic is detected in Cloudflare by matching those IPs."""
    __tablename__ = "integrators"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    ips = relationship("IntegratorIP", back_populates="integrator", cascade="all, delete-orphan",
                       order_by="IntegratorIP.id")


class IntegratorIP(Base):
    __tablename__ = "integrator_ips"

    id = Column(Integer, primary_key=True, index=True)
    integrator_id = Column(Integer, ForeignKey("integrators.id", ondelete="CASCADE"), nullable=False, index=True)
    ip = Column(String, nullable=False, unique=True)   # normalized single address (IPv4 or IPv6)
    label = Column(String, nullable=True)

    integrator = relationship("Integrator", back_populates="ips")

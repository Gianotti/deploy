from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.base import Base

# Which clients (stores) each integrator works with. Traffic is only looked up there.
integrator_clients = Table(
    "integrator_clients",
    Base.metadata,
    Column("integrator_id", Integer, ForeignKey("integrators.id", ondelete="CASCADE"), primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
)


class Integrator(Base):
    """A third party (e.g. Sincroshop) that calls some clients' APIs from known IPs.
    Its traffic is detected in Cloudflare by matching those IPs on its linked clients' sites."""
    __tablename__ = "integrators"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    notes = Column(Text, nullable=True)
    # Path prefixes it consumes, one per line (e.g. "/api/v1/products/"). Only requests to these
    # paths count as its traffic; empty = any path.
    consumes = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    ips = relationship("IntegratorIP", back_populates="integrator", cascade="all, delete-orphan",
                       order_by="IntegratorIP.id")
    user_agents = relationship("IntegratorUserAgent", back_populates="integrator", cascade="all, delete-orphan",
                               order_by="IntegratorUserAgent.id")
    clients = relationship("Client", secondary=integrator_clients, order_by="Client.name")


class IntegratorIP(Base):
    __tablename__ = "integrator_ips"

    id = Column(Integer, primary_key=True, index=True)
    integrator_id = Column(Integer, ForeignKey("integrators.id", ondelete="CASCADE"), nullable=False, index=True)
    ip = Column(String, nullable=False, unique=True)   # normalized single address (IPv4 or IPv6)
    label = Column(String, nullable=True)

    integrator = relationship("Integrator", back_populates="ips")


class IntegratorUserAgent(Base):
    """A User-Agent fragment that identifies an integrator when its IPs are unknown.
    A request matches when its User-Agent contains `pattern` (case-sensitive, like Cloudflare's
    `userAgent_like`; `_` matches any single character). Several integrators may share a pattern
    (e.g. the same SDK); then its requests count for each of them on the stores they share."""
    __tablename__ = "integrator_user_agents"
    __table_args__ = (UniqueConstraint("integrator_id", "pattern", name="uq_integrator_user_agents_integrator_pattern"),)

    id = Column(Integer, primary_key=True, index=True)
    integrator_id = Column(Integer, ForeignKey("integrators.id", ondelete="CASCADE"), nullable=False, index=True)
    pattern = Column(String, nullable=False)
    label = Column(String, nullable=True)

    integrator = relationship("Integrator", back_populates="user_agents")

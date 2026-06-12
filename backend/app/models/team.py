from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from app.db.base import Base


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    # 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
    deploy_days = Column(ARRAY(Integer), nullable=False, default=list)

    channels = relationship("TeamChannel", back_populates="team", cascade="all, delete-orphan")
    slots = relationship(
        "TeamNotificationSlot",
        back_populates="team",
        cascade="all, delete-orphan",
        order_by="TeamNotificationSlot.sort_order",
    )


class TeamChannel(Base):
    __tablename__ = "team_channels"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    webhook_url = Column(String, nullable=False)
    label = Column(String, nullable=True)

    team = relationship("Team", back_populates="channels")


class TeamNotificationSlot(Base):
    __tablename__ = "team_notification_slots"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    time = Column(String(5), nullable=True)           # "HH:MM" UTC
    message_ok = Column(String, nullable=True)        # mensaje cuando deploy está LIBRE
    message_blocked = Column(String, nullable=True)   # mensaje cuando hay promo activa

    team = relationship("Team", back_populates="slots")

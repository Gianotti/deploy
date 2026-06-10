from sqlalchemy import Column, Integer, String, Boolean
from app.db.base import Base


class NotificationConfig(Base):
    """Un solo registro de configuración de notificaciones (singleton)."""
    __tablename__ = "notification_configs"

    id = Column(Integer, primary_key=True, default=1)
    webhook_url = Column(String, nullable=False, default="")
    # Tres horarios en formato "HH:MM" (hora local UTC o del servidor)
    time_1 = Column(String(5), nullable=True)
    time_2 = Column(String(5), nullable=True)
    time_3 = Column(String(5), nullable=True)
    is_active = Column(Boolean, default=False)

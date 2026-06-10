from sqlalchemy import Column, Integer, String, Boolean, Enum as SAEnum
import enum

from app.db.base import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    READER = "reader"
    COMERCIAL = "comercial"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.READER, nullable=False)
    is_active = Column(Boolean, default=True)

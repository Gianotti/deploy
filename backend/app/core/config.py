from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://deploy_user:deploy_pass@db:5432/deploy_db"
    SECRET_KEY: str = "change-me-in-production-use-strong-secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    # Public base URL of the backend (used to build GIF URLs in Google Chat cards).
    # Must be reachable by Google's servers. Example: https://deploy.example.com
    BACKEND_PUBLIC_URL: str = ""

    class Config:
        env_file = ".env"


settings = Settings()

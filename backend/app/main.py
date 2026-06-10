from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.db.base import Base, engine
from app.scheduler import scheduler, rebuild_notification_jobs
import app.models  # ensure all models are registered before create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Crear tablas y levantar scheduler
    Base.metadata.create_all(bind=engine)
    if not scheduler.running:
        scheduler.start()

    # Restaurar jobs de notificación desde la DB
    from app.db.base import SessionLocal
    from app.models.notification_config import NotificationConfig
    db = SessionLocal()
    try:
        cfg = db.query(NotificationConfig).first()
        if cfg and cfg.is_active:
            rebuild_notification_jobs(cfg.time_1, cfg.time_2, cfg.time_3)
    finally:
        db.close()

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Deploy Window Manager",
    description="Gestión de ventanas de deploy según calendario de promociones bancarias",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}

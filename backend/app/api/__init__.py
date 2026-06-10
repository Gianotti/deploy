from fastapi import APIRouter
from app.api.endpoints import auth, countries, clients, promotions, deploy_rules, deploy_windows, public, notifications, ga4, tracking, repositories

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(countries.router)
api_router.include_router(clients.router)
api_router.include_router(promotions.router)
api_router.include_router(deploy_rules.router)
api_router.include_router(deploy_windows.router)
api_router.include_router(public.router)
api_router.include_router(notifications.router)
api_router.include_router(ga4.router)
api_router.include_router(tracking.router)
api_router.include_router(repositories.router)

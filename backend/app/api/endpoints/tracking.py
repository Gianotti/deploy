"""
Tracking de usuarios activos via GTM.
El endpoint de ping es público y devuelve un GIF 1x1 transparente para
poder usarse como Custom Image tag en GTM sin CORS ni restricciones.
"""

from fastapi import APIRouter, Response
from fastapi.responses import Response as FastAPIResponse

from app.services import tracker

router = APIRouter(prefix="/tracking", tags=["tracking"])

# GIF 1x1 transparente (43 bytes)
_PIXEL = (
    b"\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x80\x00\x00"
    b"\xff\xff\xff\x00\x00\x00\x21\xf9\x04\x00\x00\x00\x00"
    b"\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02"
    b"\x44\x01\x00\x3b"
)


@router.get("/{client_id}/ping")
def ping(client_id: int):
    """
    GTM dispara esta URL en cada page view.
    Registra la visita y devuelve un pixel transparente.
    No requiere autenticación.
    """
    tracker.record(client_id)
    return FastAPIResponse(
        content=_PIXEL,
        media_type="image/gif",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/active")
def get_all_active():
    """Retorna usuarios activos (últimos 5 min) por client_id. No requiere auth."""
    return tracker.all_active()

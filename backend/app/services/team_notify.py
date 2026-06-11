"""Envío de notificaciones de equipo a webhooks de Google Chat."""

import requests
from app.core.config import settings


def _build_payload(message: str, slot_id: int, has_gif: bool) -> dict:
    """Construye el payload para el webhook. Usa card si hay GIF, text simple si no."""
    if has_gif and settings.BACKEND_PUBLIC_URL:
        gif_url = f"{settings.BACKEND_PUBLIC_URL.rstrip('/')}/public/team-gif/{slot_id}"
        return {
            "cards": [{
                "sections": [{
                    "widgets": [
                        {"image": {"imageUrl": gif_url}},
                        {"textParagraph": {"text": message}},
                    ]
                }]
            }]
        }
    return {"text": message}


def send_slot(team, slot, force_ok: bool = False) -> list[str]:
    """
    Envía el mensaje del slot a todos los canales del equipo.
    Elige message_ok o message_blocked según el estado global de deploy.
    Retorna lista de strings de error (vacía si todo OK).
    """
    message = _pick_message(slot, force_ok)
    if not message:
        return []

    payload = _build_payload(message, slot.id, slot.gif_data is not None)
    errors = []
    for channel in team.channels:
        try:
            resp = requests.post(channel.webhook_url, json=payload, timeout=10)
            resp.raise_for_status()
        except Exception as e:
            errors.append(f"{channel.label or 'Canal'}: {e}")
    return errors


def _pick_message(slot, force_ok: bool) -> str | None:
    """Devuelve el mensaje apropiado según si se puede deployar hoy."""
    if force_ok:
        return slot.message_ok or slot.message_blocked

    can_deploy = _global_can_deploy()
    if can_deploy:
        return slot.message_ok or slot.message_blocked
    return slot.message_blocked or slot.message_ok


def _global_can_deploy() -> bool:
    """True si ningún cliente tiene promo activa (BLOQUEADO o RESTRINGIDO) hoy."""
    from datetime import datetime
    import pytz
    from app.db.base import SessionLocal
    from app.models.client import Client
    from app.models.country import Country
    from app.models.deploy_rule import DeployRule, DeployStatus
    from app.models.promotion import Promotion
    from app.rules.engine import _active_promotions_on_date, compute_day_status

    db = SessionLocal()
    try:
        rules = db.query(DeployRule).all()
        clients = db.query(Client).all()
        for client in clients:
            country = db.get(Country, client.country_id)
            tz = pytz.timezone(country.timezone)
            today = datetime.now(tz).date()
            promotions = (
                db.query(Promotion)
                .filter(
                    Promotion.client_id == client.id,
                    Promotion.start_date <= today,
                    Promotion.end_date >= today,
                )
                .all()
            )
            active = _active_promotions_on_date(promotions, today)
            status, _, _ = compute_day_status(today, active, rules)
            if status != DeployStatus.LIBRE:
                return False
        return True
    finally:
        db.close()

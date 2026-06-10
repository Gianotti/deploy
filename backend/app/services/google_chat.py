"""Envía mensajes de deploy status a un webhook de Google Chat."""

from datetime import datetime
from typing import List

import pytz
import requests

from app.models.deploy_rule import DeployStatus
from app.rules.engine import _active_promotions_on_date, compute_day_status
from app.models.promotion import Promotion
from app.models.deploy_rule import DeployRule


STATUS_EMOJI = {
    DeployStatus.LIBRE:       "✅",
    DeployStatus.RESTRINGIDO: "🟡",
    DeployStatus.BLOQUEADO:   "🔴",
}

STATUS_LABEL = {
    DeployStatus.LIBRE:       "LIBRE",
    DeployStatus.RESTRINGIDO: "CON AVISO",
    DeployStatus.BLOQUEADO:   "BLOQUEADO",
}


def build_status_message(client_statuses: list) -> str:
    """
    client_statuses: list of dicts con keys:
      client_name, country_name, deploy_status, window_start, window_end, active_promo_count
    """
    now_utc = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"🚀 *Deploy Status* — {now_utc}", ""]

    for cs in client_statuses:
        status = cs["deploy_status"]
        emoji = STATUS_EMOJI.get(status, "❓")
        label = STATUS_LABEL.get(status, status)
        line = f"{emoji} *{label}* — {cs['client_name']} ({cs['country_name']})"
        if cs.get("window_start"):
            line += f"  ·  ventana: {cs['window_start']}–{cs['window_end']}"
        if cs.get("active_promo_count", 0) > 0:
            count = cs["active_promo_count"]
            line += f"  ·  {count} promo{'s' if count > 1 else ''} activa{'s' if count > 1 else ''}"
        lines.append(line)

    return "\n".join(lines)


def send_to_webhook(webhook_url: str, message: str) -> bool:
    """Envía un mensaje de texto simple al webhook de Google Chat. Retorna True si OK."""
    try:
        resp = requests.post(
            webhook_url,
            json={"text": message},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"[Google Chat] Error enviando webhook: {e}")
        return False


def collect_client_statuses(db) -> list:
    """Recorre todos los clientes y calcula su estado de deploy para hoy."""
    from app.models.client import Client
    from app.models.country import Country

    rules = db.query(DeployRule).all()
    clients = db.query(Client).all()
    result = []

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
        status, ws, we = compute_day_status(today, active, rules)

        result.append({
            "client_name": client.name,
            "country_name": country.name,
            "deploy_status": status,
            "window_start": ws,
            "window_end": we,
            "active_promo_count": len(active),
        })

    # orden: bloqueado primero
    weight = {DeployStatus.BLOQUEADO: 0, DeployStatus.RESTRINGIDO: 1, DeployStatus.LIBRE: 2}
    result.sort(key=lambda r: weight.get(r["deploy_status"], 9))
    return result

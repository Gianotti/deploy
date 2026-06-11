"""
APScheduler setup.
Los jobs de notificación se reconstruyen cada vez que la config cambia.
"""

from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = BackgroundScheduler(timezone="UTC")


# ── Global deploy-status notifications ────────────────────────────────────────

def _notify_job():
    from app.db.base import SessionLocal
    from app.models.notification_config import NotificationConfig
    from app.services.google_chat import collect_client_statuses, build_status_message, send_to_webhook

    db = SessionLocal()
    try:
        cfg = db.query(NotificationConfig).first()
        if not cfg or not cfg.is_active or not cfg.webhook_url:
            return
        statuses = collect_client_statuses(db)
        msg = build_status_message(statuses)
        send_to_webhook(cfg.webhook_url, msg)
    finally:
        db.close()


def rebuild_notification_jobs(time_1: str | None, time_2: str | None, time_3: str | None):
    """Elimina jobs anteriores y recrea los 3 slots de horario globales."""
    for job_id in ("notify_1", "notify_2", "notify_3"):
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)

    for job_id, t in [("notify_1", time_1), ("notify_2", time_2), ("notify_3", time_3)]:
        if t:
            hour, minute = map(int, t.split(":"))
            scheduler.add_job(
                _notify_job,
                CronTrigger(hour=hour, minute=minute, timezone="UTC"),
                id=job_id,
                replace_existing=True,
                max_instances=1,
            )


# ── Team notifications ─────────────────────────────────────────────────────────

def _team_notify_job(team_id: int, slot_number: int):
    """Envía el mensaje del slot al equipo si hoy es día de deploy."""
    import requests
    from app.db.base import SessionLocal
    from app.models.team import Team

    db = SessionLocal()
    try:
        team = db.get(Team, team_id)
        if not team:
            return

        # Solo enviar en días de deploy del equipo (0=Lun … 6=Dom, UTC)
        if team.deploy_days and datetime.utcnow().weekday() not in team.deploy_days:
            return

        slot = next((s for s in team.slots if s.slot_number == slot_number), None)
        if not slot or not slot.message:
            return

        for channel in team.channels:
            try:
                requests.post(channel.webhook_url, json={"text": slot.message}, timeout=10)
            except Exception as e:
                print(f"[Team {team.name} / {channel.label}] Error webhook: {e}")
    finally:
        db.close()


def rebuild_team_jobs(team_id: int, slots, channels, deploy_days):
    """Elimina y recrea los jobs del scheduler para un equipo."""
    for n in (1, 2, 3):
        jid = f"team_{team_id}_slot_{n}"
        if scheduler.get_job(jid):
            scheduler.remove_job(jid)

    if not channels:
        return

    for slot in slots:
        if not slot.time:
            continue
        hour, minute = map(int, slot.time.split(":"))
        scheduler.add_job(
            _team_notify_job,
            CronTrigger(hour=hour, minute=minute, timezone="UTC"),
            id=f"team_{team_id}_slot_{slot.slot_number}",
            args=[team_id, slot.slot_number],
            replace_existing=True,
            max_instances=1,
        )


def remove_team_jobs(team_id: int):
    for n in (1, 2, 3):
        jid = f"team_{team_id}_slot_{n}"
        if scheduler.get_job(jid):
            scheduler.remove_job(jid)


def rebuild_all_team_jobs():
    """Restaura todos los jobs de equipos desde la DB (llamado al startup)."""
    from app.db.base import SessionLocal
    from app.models.team import Team

    db = SessionLocal()
    try:
        teams = db.query(Team).all()
        for team in teams:
            rebuild_team_jobs(team.id, team.slots, team.channels, team.deploy_days)
    finally:
        db.close()

"""
APScheduler setup.
Los jobs de notificación se reconstruyen cada vez que la config cambia.
"""

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = BackgroundScheduler(timezone="UTC")


def _notify_job():
    """Job que corre el scheduler: abre su propia sesión de DB."""
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
    """Elimina jobs anteriores y recrea los 3 slots de horario."""
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

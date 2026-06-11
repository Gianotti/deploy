import requests

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.team import Team, TeamChannel, TeamNotificationSlot
from app.scheduler import rebuild_team_jobs, remove_team_jobs
from app.schemas.team import (
    TeamCreate, TeamUpdate, TeamOut,
    TeamChannelIn, TeamChannelOut,
    TeamNotificationSlotIn, TeamNotificationSlotOut,
)

router = APIRouter(prefix="/teams", tags=["teams"])


def _rebuild(team: Team):
    rebuild_team_jobs(team.id, team.slots, team.channels, team.deploy_days)


# ── CRUD de equipos ───────────────────────────────────────────────────────────

@router.get("/", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Team).all()


@router.post("/", response_model=TeamOut, dependencies=[Depends(require_admin)])
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    if db.query(Team).filter(Team.name == payload.name).first():
        raise HTTPException(400, "Ya existe un equipo con ese nombre")
    team = Team(name=payload.name, deploy_days=payload.deploy_days)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.patch("/{team_id}", response_model=TeamOut, dependencies=[Depends(require_admin)])
def update_team(team_id: int, payload: TeamUpdate, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    if payload.name is not None:
        team.name = payload.name
    if payload.deploy_days is not None:
        team.deploy_days = payload.deploy_days
    db.commit()
    db.refresh(team)
    _rebuild(team)
    return team


@router.delete("/{team_id}", dependencies=[Depends(require_admin)])
def delete_team(team_id: int, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    remove_team_jobs(team_id)
    db.delete(team)
    db.commit()
    return {"deleted": True}


# ── Canales ───────────────────────────────────────────────────────────────────

@router.post("/{team_id}/channels", response_model=TeamOut, dependencies=[Depends(require_admin)])
def add_channel(team_id: int, payload: TeamChannelIn, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    channel = TeamChannel(team_id=team_id, webhook_url=payload.webhook_url, label=payload.label)
    db.add(channel)
    db.commit()
    db.refresh(team)
    _rebuild(team)
    return team


@router.delete("/{team_id}/channels/{channel_id}", response_model=TeamOut, dependencies=[Depends(require_admin)])
def remove_channel(team_id: int, channel_id: int, db: Session = Depends(get_db)):
    channel = db.get(TeamChannel, channel_id)
    if not channel or channel.team_id != team_id:
        raise HTTPException(404, "Canal no encontrado")
    db.delete(channel)
    db.commit()
    team = db.get(Team, team_id)
    _rebuild(team)
    return team


# ── Slots de notificación ─────────────────────────────────────────────────────

@router.put("/{team_id}/slots", response_model=TeamOut, dependencies=[Depends(require_admin)])
def upsert_slots(team_id: int, payload: list[TeamNotificationSlotIn], db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")

    existing = {s.slot_number: s for s in team.slots}
    for slot_in in payload:
        if slot_in.slot_number not in (1, 2, 3):
            raise HTTPException(400, "slot_number debe ser 1, 2 o 3")
        if slot_in.slot_number in existing:
            existing[slot_in.slot_number].time = slot_in.time
            existing[slot_in.slot_number].message = slot_in.message
        else:
            db.add(TeamNotificationSlot(
                team_id=team_id,
                slot_number=slot_in.slot_number,
                time=slot_in.time,
                message=slot_in.message,
            ))

    db.commit()
    db.refresh(team)
    _rebuild(team)
    return team


# ── Test de notificación ──────────────────────────────────────────────────────

@router.post("/{team_id}/test-notify/{slot_number}", dependencies=[Depends(require_admin)])
def test_notify(team_id: int, slot_number: int, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    if not team.channels:
        raise HTTPException(400, "El equipo no tiene canales configurados")

    slot = next((s for s in team.slots if s.slot_number == slot_number), None)
    if not slot or not slot.message:
        raise HTTPException(400, f"El slot {slot_number} no tiene mensaje configurado")

    errors = []
    for channel in team.channels:
        try:
            resp = requests.post(channel.webhook_url, json={"text": slot.message}, timeout=10)
            resp.raise_for_status()
        except Exception as e:
            errors.append(f"{channel.label or channel.webhook_url[:40]}: {e}")

    if errors:
        raise HTTPException(502, "Errores al enviar: " + " | ".join(errors))

    return {"sent": True, "channels": len(team.channels)}

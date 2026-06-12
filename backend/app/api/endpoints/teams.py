import requests

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.base import get_db
from app.models.team import Team, TeamChannel, TeamNotificationSlot
from app.scheduler import rebuild_team_jobs, remove_team_jobs
from app.schemas.team import (
    TeamCreate, TeamUpdate, TeamOut,
    TeamChannelIn,
    TeamNotificationSlotIn, TeamNotificationSlotOut,
)

router = APIRouter(prefix="/teams", tags=["teams"])


def _team_out(team: Team) -> TeamOut:
    return TeamOut(
        id=team.id,
        name=team.name,
        deploy_days=team.deploy_days,
        channels=[c for c in team.channels],
        slots=[TeamNotificationSlotOut.from_orm_slot(s) for s in team.slots],
    )


def _rebuild(team: Team):
    rebuild_team_jobs(team.id, team.slots, team.channels, team.deploy_days)


# ── CRUD de equipos ───────────────────────────────────────────────────────────

@router.get("/", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [_team_out(t) for t in db.query(Team).all()]


@router.post("/", response_model=TeamOut, dependencies=[Depends(require_admin)])
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    if db.query(Team).filter(Team.name == payload.name).first():
        raise HTTPException(400, "Ya existe un equipo con ese nombre")
    team = Team(name=payload.name, deploy_days=payload.deploy_days)
    db.add(team)
    db.commit()
    db.refresh(team)
    return _team_out(team)


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
    return _team_out(team)


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
    db.add(TeamChannel(team_id=team_id, webhook_url=payload.webhook_url, label=payload.label))
    db.commit()
    db.refresh(team)
    _rebuild(team)
    return _team_out(team)


@router.delete("/{team_id}/channels/{channel_id}", response_model=TeamOut, dependencies=[Depends(require_admin)])
def remove_channel(team_id: int, channel_id: int, db: Session = Depends(get_db)):
    channel = db.get(TeamChannel, channel_id)
    if not channel or channel.team_id != team_id:
        raise HTTPException(404, "Canal no encontrado")
    db.delete(channel)
    db.commit()
    team = db.get(Team, team_id)
    _rebuild(team)
    return _team_out(team)


# ── Slots de notificación ─────────────────────────────────────────────────────

@router.post("/{team_id}/slots", response_model=TeamOut, dependencies=[Depends(require_admin)])
def add_slot(team_id: int, payload: TeamNotificationSlotIn, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    # sort_order = max existing + 1
    max_order = max((s.sort_order for s in team.slots), default=-1)
    slot = TeamNotificationSlot(
        team_id=team_id,
        sort_order=max_order + 1,
        time=payload.time,
        message_ok=payload.message_ok,
        message_blocked=payload.message_blocked,
    )
    db.add(slot)
    db.commit()
    db.refresh(team)
    _rebuild(team)
    return _team_out(team)


@router.patch("/{team_id}/slots/{slot_id}", response_model=TeamOut, dependencies=[Depends(require_admin)])
def update_slot(team_id: int, slot_id: int, payload: TeamNotificationSlotIn, db: Session = Depends(get_db)):
    slot = db.get(TeamNotificationSlot, slot_id)
    if not slot or slot.team_id != team_id:
        raise HTTPException(404, "Slot no encontrado")
    slot.time = payload.time
    slot.message_ok = payload.message_ok
    slot.message_blocked = payload.message_blocked
    db.commit()
    team = db.get(Team, team_id)
    db.refresh(team)
    _rebuild(team)
    return _team_out(team)


@router.delete("/{team_id}/slots/{slot_id}", response_model=TeamOut, dependencies=[Depends(require_admin)])
def delete_slot(team_id: int, slot_id: int, db: Session = Depends(get_db)):
    slot = db.get(TeamNotificationSlot, slot_id)
    if not slot or slot.team_id != team_id:
        raise HTTPException(404, "Slot no encontrado")
    team = db.get(Team, team_id)
    if len(team.slots) <= 1:
        raise HTTPException(400, "El equipo debe tener al menos un horario")
    db.delete(slot)
    db.commit()
    db.refresh(team)
    _rebuild(team)
    return _team_out(team)


# ── Test de notificación ──────────────────────────────────────────────────────

@router.post("/{team_id}/slots/{slot_id}/test-notify", dependencies=[Depends(require_admin)])
def test_notify(team_id: int, slot_id: int, db: Session = Depends(get_db)):
    from app.services.team_notify import send_slot
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    if not team.channels:
        raise HTTPException(400, "El equipo no tiene canales configurados")
    slot = db.get(TeamNotificationSlot, slot_id)
    if not slot or slot.team_id != team_id:
        raise HTTPException(404, "Slot no encontrado")
    if not slot.message_ok and not slot.message_blocked:
        raise HTTPException(400, "El slot no tiene mensajes configurados")

    # Para el test forzamos message_ok (deploy libre)
    errors = send_slot(team, slot, force_ok=True)
    if errors:
        raise HTTPException(502, "Errores al enviar: " + " | ".join(errors))
    return {"sent": True, "channels": len(team.channels)}

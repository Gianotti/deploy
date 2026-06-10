"""
Deploy Rules Engine
===================
Defaults (cuando no hay regla configurada para el tipo):
  PROMO_ESPECIAL → BLOQUEADO  (bloquea todo el día sin excepción)
  PROMO_NORMAL   → RESTRINGIDO sin ventana  (se puede deployar avisando,
                   pero se recomienda configurar una ventana en DeployRule)

Priority: BLOQUEADO > RESTRINGIDO > LIBRE
"""

from datetime import date, datetime, timedelta, time
from typing import List, Optional, Tuple

import pytz
from sqlalchemy.orm import Session

from app.models.deploy_rule import DeployRule, DeployStatus
from app.models.promotion import Promotion, PromoType
from app.schemas.deploy_window import DeployWindowDay

# Numeric weight for sorting: higher = more restrictive
_STATUS_WEIGHT = {
    DeployStatus.LIBRE: 0,
    DeployStatus.RESTRINGIDO: 1,
    DeployStatus.BLOQUEADO: 2,
}


def _worse(a: DeployStatus, b: DeployStatus) -> DeployStatus:
    return a if _STATUS_WEIGHT[a] >= _STATUS_WEIGHT[b] else b


def _active_promotions_on_date(
    promotions: List[Promotion], target_date: date
) -> List[Promotion]:
    return [p for p in promotions if p.start_date <= target_date <= p.end_date]


def _evaluate_promotion(
    promotion: Promotion, rules: List[DeployRule]
) -> Tuple[DeployStatus, Optional[str], Optional[str]]:
    """
    Find the best-matching rule for a promotion.
    Matching criteria: same promo_type AND criticality >= rule.min_criticality.
    When multiple rules match, the most restrictive one wins.
    Falls back to BLOQUEADO for FULL_PROMO (default) or LIBRE for others.
    """
    matching = [
        r for r in rules
        if r.promo_type == promotion.promo_type
        and promotion.criticality >= r.min_criticality
    ]

    if not matching:
        # Defaults sin regla configurada
        if promotion.promo_type == PromoType.PROMO_ESPECIAL:
            return DeployStatus.BLOQUEADO, None, None
        # PROMO_NORMAL sin regla → RESTRINGIDO (puede deployar avisando)
        return DeployStatus.RESTRINGIDO, None, None

    # Pick the most restrictive matching rule
    best = max(matching, key=lambda r: _STATUS_WEIGHT[r.deploy_status])
    return best.deploy_status, best.window_start, best.window_end


def compute_day_status(
    target_date: date,
    promotions_on_day: List[Promotion],
    rules: List[DeployRule],
) -> Tuple[DeployStatus, Optional[str], Optional[str]]:
    """
    Returns (status, window_start, window_end) for a single day.
    Aggregates across all active promotions: worst status wins.
    Window is only meaningful when status == RESTRINGIDO.
    """
    if not promotions_on_day:
        return DeployStatus.LIBRE, None, None

    worst_status = DeployStatus.LIBRE
    window_start: Optional[str] = None
    window_end: Optional[str] = None

    for promo in promotions_on_day:
        status, ws, we = _evaluate_promotion(promo, rules)
        if _STATUS_WEIGHT[status] > _STATUS_WEIGHT[worst_status]:
            worst_status = status
            window_start = ws
            window_end = we
        elif status == worst_status and worst_status == DeployStatus.RESTRINGIDO:
            # Intersect windows to get the most conservative allowed range
            if ws and window_start:
                window_start = max(window_start, ws)
            if we and window_end:
                window_end = min(window_end, we)

    return worst_status, window_start, window_end


def can_deploy_now(
    status: DeployStatus,
    window_start: Optional[str],
    window_end: Optional[str],
    timezone: str,
) -> bool:
    """Check if a deploy is allowed at the current moment in the given timezone."""
    if status == DeployStatus.BLOQUEADO:
        return False
    if status == DeployStatus.LIBRE:
        return True

    # RESTRINGIDO: check current local time against window
    if not window_start or not window_end:
        return False

    tz = pytz.timezone(timezone)
    now_local = datetime.now(tz).time().replace(second=0, microsecond=0)
    start = time(*map(int, window_start.split(":")))
    end = time(*map(int, window_end.split(":")))
    return start <= now_local <= end


def compute_windows(
    client_id: int,
    promotions: List[Promotion],
    rules: List[DeployRule],
    from_date: date,
    to_date: date,
) -> List[DeployWindowDay]:
    """
    Compute DeployWindowDay for every date in [from_date, to_date].
    """
    result: List[DeployWindowDay] = []
    current = from_date
    while current <= to_date:
        active = _active_promotions_on_date(promotions, current)
        status, ws, we = compute_day_status(current, active, rules)
        result.append(
            DeployWindowDay(
                date=current,
                deploy_status=status,
                window_start=ws,
                window_end=we,
                active_promotions=active,
            )
        )
        current += timedelta(days=1)
    return result

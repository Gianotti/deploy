"""Unit tests for the deploy rules engine (no DB required)."""

from datetime import date
from unittest.mock import MagicMock

import pytest

from app.models.deploy_rule import DeployRule, DeployStatus
from app.models.promotion import Promotion, PromoType
from app.rules.engine import (
    compute_day_status,
    compute_windows,
    can_deploy_now,
    _active_promotions_on_date,
)


def make_promo(promo_type: PromoType, criticality: int = 1) -> Promotion:
    p = MagicMock(spec=Promotion)
    p.promo_type = promo_type
    p.criticality = criticality
    today = date.today()
    p.start_date = today
    p.end_date = today
    return p


def make_rule(promo_type: PromoType, min_criticality: int, status: DeployStatus,
              ws=None, we=None) -> DeployRule:
    r = MagicMock(spec=DeployRule)
    r.promo_type = promo_type
    r.min_criticality = min_criticality
    r.deploy_status = status
    r.window_start = ws
    r.window_end = we
    return r


# --- _active_promotions_on_date ---

def test_active_promotions_filters_by_date():
    from datetime import timedelta
    today = date.today()
    p = MagicMock(spec=Promotion)
    p.start_date = today
    p.end_date = today
    assert p in _active_promotions_on_date([p], today)


def test_active_promotions_excludes_outside_range():
    from datetime import timedelta
    today = date.today()
    p = MagicMock(spec=Promotion)
    p.start_date = today
    p.end_date = today
    assert _active_promotions_on_date([p], today + timedelta(days=1)) == []


# --- compute_day_status defaults ---

def test_no_promotions_returns_libre():
    status, ws, we = compute_day_status(date.today(), [], [])
    assert status == DeployStatus.LIBRE
    assert ws is None and we is None


def test_promo_especial_no_rule_returns_bloqueado():
    promo = make_promo(PromoType.PROMO_ESPECIAL, criticality=5)
    status, _, _ = compute_day_status(date.today(), [promo], [])
    assert status == DeployStatus.BLOQUEADO


def test_promo_normal_no_rule_returns_restringido():
    """Sin regla configurada, PROMO_NORMAL → RESTRINGIDO (puede deployar avisando)."""
    promo = make_promo(PromoType.PROMO_NORMAL, criticality=2)
    status, _, _ = compute_day_status(date.today(), [promo], [])
    assert status == DeployStatus.RESTRINGIDO


# --- reglas configuradas ---

def test_rule_maps_promo_normal_with_window():
    promo = make_promo(PromoType.PROMO_NORMAL, criticality=3)
    rule = make_rule(PromoType.PROMO_NORMAL, min_criticality=3,
                     status=DeployStatus.RESTRINGIDO, ws="22:00", we="06:00")
    status, ws, we = compute_day_status(date.today(), [promo], [rule])
    assert status == DeployStatus.RESTRINGIDO
    assert ws == "22:00"


def test_especial_beats_normal():
    """PROMO_ESPECIAL siempre gana sobre PROMO_NORMAL."""
    promo_normal = make_promo(PromoType.PROMO_NORMAL, criticality=1)
    promo_especial = make_promo(PromoType.PROMO_ESPECIAL, criticality=5)
    rule = make_rule(PromoType.PROMO_NORMAL, 1, DeployStatus.RESTRINGIDO, "20:00", "08:00")
    status, _, _ = compute_day_status(date.today(), [promo_normal, promo_especial], [rule])
    assert status == DeployStatus.BLOQUEADO


def test_criticality_threshold_not_met_falls_back_to_default():
    """Regla no aplica (criticidad < umbral) → cae al default del motor."""
    promo = make_promo(PromoType.PROMO_NORMAL, criticality=1)
    rule = make_rule(PromoType.PROMO_NORMAL, min_criticality=3,
                     status=DeployStatus.RESTRINGIDO, ws="22:00", we="05:00")
    status, _, _ = compute_day_status(date.today(), [promo], [rule])
    # Default PROMO_NORMAL sin regla coincidente → RESTRINGIDO sin ventana
    assert status == DeployStatus.RESTRINGIDO


# --- compute_windows ---

def test_compute_windows_length():
    from datetime import timedelta
    today = date.today()
    windows = compute_windows(1, [], [], today, today + timedelta(days=6))
    assert len(windows) == 7


def test_compute_windows_all_libre_with_no_promos():
    from datetime import timedelta
    today = date.today()
    windows = compute_windows(1, [], [], today, today + timedelta(days=2))
    for w in windows:
        assert w.deploy_status == DeployStatus.LIBRE


# --- can_deploy_now ---

def test_can_deploy_now_bloqueado():
    assert can_deploy_now(DeployStatus.BLOQUEADO, None, None, "America/Argentina/Buenos_Aires") is False


def test_can_deploy_now_libre():
    assert can_deploy_now(DeployStatus.LIBRE, None, None, "America/Argentina/Buenos_Aires") is True


def test_can_deploy_now_restringido_sin_ventana():
    assert can_deploy_now(DeployStatus.RESTRINGIDO, None, None, "America/Argentina/Buenos_Aires") is False

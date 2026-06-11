"""
Tracker de usuarios activos en memoria.
Registra timestamps de page views por cliente; "activo" = visto en los últimos WINDOW_MINUTES.
Thread-safe con Lock. Los datos se pierden al reiniciar el contenedor (es intencional: solo
necesitamos datos en tiempo real).
"""

import threading
import time
from collections import defaultdict
from datetime import datetime, timezone

WINDOW_SECONDS = 5 * 60  # 5 minutos = "usuario activo"

_lock = threading.Lock()
_events: dict[int, list[float]] = defaultdict(list)  # client_id -> [unix_timestamp, ...]

# Daily peak for the ecosystem total (resets at UTC midnight automatically via date check)
_ecosystem_peak: dict[str, int] = {"date": "", "peak": 0}


def record(client_id: int) -> None:
    now = time.time()
    with _lock:
        _events[client_id].append(now)
        cutoff = now - WINDOW_SECONDS
        _events[client_id] = [t for t in _events[client_id] if t >= cutoff]


def active_users(client_id: int) -> int:
    cutoff = time.time() - WINDOW_SECONDS
    with _lock:
        return sum(1 for t in _events[client_id] if t >= cutoff)


def all_active() -> dict[int, int]:
    cutoff = time.time() - WINDOW_SECONDS
    with _lock:
        return {
            cid: sum(1 for t in ts if t >= cutoff)
            for cid, ts in _events.items()
        }


def update_ecosystem_peak(total: int) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        if _ecosystem_peak["date"] != today:
            _ecosystem_peak["date"] = today
            _ecosystem_peak["peak"] = total
        elif total > _ecosystem_peak["peak"]:
            _ecosystem_peak["peak"] = total


def get_ecosystem_peak() -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        return _ecosystem_peak["peak"] if _ecosystem_peak["date"] == today else 0

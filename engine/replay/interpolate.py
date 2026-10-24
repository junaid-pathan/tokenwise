"""Load the cached hourly curve and interpolate it to per-minute points.

Pure, side-effect-free helpers so the replay clock and the tests can share the
same math. No asyncio, no FastAPI here.
"""

from __future__ import annotations

import json
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "grid" / "june24.json"
MINUTES_PER_DAY = 24 * 60  # 1440


def load_cache(path: Path | None = None) -> dict:
    """Load the june24.json cache dict (metadata + 24 hourly points)."""
    p = path or CACHE_PATH
    data = json.loads(p.read_text(encoding="utf-8"))
    points = data.get("points")
    if not points or len(points) != 24:
        raise ValueError(
            f"cache at {p} must have exactly 24 hourly points, got "
            f"{0 if not points else len(points)}"
        )
    return data


def hourly_loads(cache: dict) -> list[float]:
    """Return the 24 hourly load_mw values in hour order 0..23."""
    points = sorted(cache["points"], key=lambda pt: pt["hour"])
    return [float(pt["load_mw"]) for pt in points]


def interpolate_to_minutes(hourly: list[float]) -> list[float]:
    """Linear interpolation from 24 hourly values to 1440 per-minute values.

    Minute m (0..1439) sits at hour h = m // 60 with fraction f = (m % 60)/60.
    The segment runs from hour h to hour h+1; hour 24 wraps to the NEXT day's
    00:00, which we approximate with the same day's hour 0 so minute 1439 is a
    sensible value just before midnight. Minute 0 == hour 0 exactly, and each
    whole hour h (minute h*60) == hourly[h] exactly.
    """
    if len(hourly) != 24:
        raise ValueError(f"expected 24 hourly values, got {len(hourly)}")
    out: list[float] = []
    for minute in range(MINUTES_PER_DAY):
        h = minute // 60
        frac = (minute % 60) / 60.0
        start = hourly[h]
        end = hourly[h + 1] if h + 1 < 24 else hourly[0]
        out.append(start + (end - start) * frac)
    return out


def minute_clock(minute: int, date_iso: str = "2025-06-24") -> str:
    """Local ISO clock string for a given minute, no timezone suffix.

    minute 0 -> '2025-06-24T00:00:00', minute 960 -> '2025-06-24T16:00:00'.
    """
    if not (0 <= minute < MINUTES_PER_DAY):
        raise ValueError(f"minute out of range: {minute}")
    hh = minute // 60
    mm = minute % 60
    return f"{date_iso}T{hh:02d}:{mm:02d}:00"


def minute_series(cache: dict | None = None, date_iso: str = "2025-06-24") -> list[dict]:
    """Full 1440-point series of {minute, replay_clock, load_mw} for the day."""
    c = cache or load_cache()
    loads = interpolate_to_minutes(hourly_loads(c))
    return [
        {"minute": m, "replay_clock": minute_clock(m, date_iso), "load_mw": loads[m]}
        for m in range(MINUTES_PER_DAY)
    ]

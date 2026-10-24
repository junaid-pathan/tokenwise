"""A (PR A2): Power meter. Polls the Colab /power endpoint and integrates energy.

At the Hardware gate we chose Colab T4 as the power source (POWER_SOURCE=cloud).

Contract (unchanged):
    energy_between(t0, t1) -> (joules: float, source: str)
    source is one of: "nvidia-smi" | "cloud" | "estimate"

register(bus, app) starts a 2 Hz sampler that pulls {POWER_URL}/power/history,
converts Colab timestamps to local time, keeps ~20 min of samples in memory, and
emits power.sample events (contracts/events.py). If POWER_URL is unreachable,
energy_between falls back to a gears.json-derived estimate.
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
from pathlib import Path

import httpx

_GEARS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "gears.json"

# Fallback average draw (W) when no live meter is reachable.
_ESTIMATE_WATTS = 60.0

_POLL_INTERVAL_S = 0.5           # poll the Colab history endpoint at 2 Hz
_HISTORY_WINDOW_S = 20 * 60      # keep ~20 minutes of samples
_IDLE_WINDOW_S = 10.0            # measure idle baseline over the first 10 s at util 0


class _PowerStore:
    """Holds recent (local_ts, watts, util) samples and the idle baseline."""

    def __init__(self) -> None:
        # list of (local_ts, watts, util), kept sorted by local_ts
        self.samples: list[tuple[float, float, float]] = []
        self.device: str = "unknown"
        self.idle_watts: float | None = None
        self._idle_candidates: list[float] = []
        self._first_seen: float | None = None
        self.last_colab_ts: float = 0.0  # highest Colab ts we've ingested
        self.reachable: bool = False

    def add(self, local_ts: float, watts: float, util: float) -> None:
        self.samples.append((local_ts, watts, util))
        # trim to the window
        cutoff = local_ts - _HISTORY_WINDOW_S
        if self.samples and self.samples[0][0] < cutoff:
            self.samples = [s for s in self.samples if s[0] >= cutoff]
        # idle baseline: median watts over the first 10 s where util == 0
        if self._first_seen is None:
            self._first_seen = local_ts
        if self.idle_watts is None:
            if util == 0 and local_ts - self._first_seen <= _IDLE_WINDOW_S:
                self._idle_candidates.append(watts)
            elif local_ts - self._first_seen > _IDLE_WINDOW_S and self._idle_candidates:
                self.idle_watts = statistics.median(self._idle_candidates)

    def idle(self) -> float:
        if self.idle_watts is not None:
            return self.idle_watts
        if self._idle_candidates:
            return statistics.median(self._idle_candidates)
        return 0.0


store = _PowerStore()


def _power_url() -> str:
    return os.environ.get("POWER_URL", "").strip().rstrip("/")


def _estimate_watts() -> float:
    """Fallback average draw (W). Prefer a gears.json hint if present, else the
    idle baseline we measured, else a conservative constant. gears.json currently
    carries no per-watt figure (est_wh_per_1k_out_tokens is null until the gate),
    so this stays watts-based and documented."""
    try:
        data = json.loads(_GEARS_PATH.read_text(encoding="utf-8"))
        hint = data.get("levels", {}).get("estimate_watts")
        if hint:
            return float(hint)
    except Exception:
        pass
    if store.idle_watts:
        return store.idle_watts
    return _ESTIMATE_WATTS


def _integrate(t0: float, t1: float, subtract_idle: bool = False) -> float | None:
    """Trapezoid-integrate watts over [t0, t1] (local time) -> joules.

    Returns None if there are not enough samples covering the interval.
    """
    if t1 <= t0:
        return 0.0
    pts = [(ts, w) for (ts, w, _u) in store.samples if t0 <= ts <= t1]
    if len(pts) < 2:
        return None
    pts.sort()
    idle = store.idle() if subtract_idle else 0.0
    joules = 0.0
    for (ta, wa), (tb, wb) in zip(pts, pts[1:]):
        wa_adj = max(0.0, wa - idle)
        wb_adj = max(0.0, wb - idle)
        joules += (wa_adj + wb_adj) / 2.0 * (tb - ta)
    return joules


def energy_between(t0: float, t1: float) -> tuple[float, str]:
    """Return (joules, source) for the interval [t0, t1] in local epoch seconds.

    Uses measured watts when the live meter has covered the interval, otherwise
    falls back to a gears.json-derived estimate.
    """
    measured = _integrate(t0, t1, subtract_idle=False)
    if measured is not None and store.reachable:
        return (measured, "measured")
    seconds = max(0.0, t1 - t0)
    return (_estimate_watts() * seconds, "estimated")


def joules_above_idle(t0: float, t1: float) -> tuple[float, str]:
    """Like energy_between but subtracts the idle baseline (net compute energy)."""
    measured = _integrate(t0, t1, subtract_idle=True)
    if measured is not None and store.reachable:
        return (measured, "measured")
    seconds = max(0.0, t1 - t0)
    return (max(0.0, _estimate_watts() - store.idle()) * seconds, "estimated")


async def _poll_loop(bus) -> None:
    url = _power_url()
    if not url:
        print("[power] POWER_URL not set; sampler disabled (energy falls back to estimate)")
        return

    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                resp = await client.get(
                    f"{url}/power/history", params={"since": store.last_colab_ts}
                )
                resp.raise_for_status()
                data = resp.json()
                store.reachable = True
                store.device = data.get("device", store.device)
                colab_now = float(data["now"])
                # Colab clock vs local clock offset, recomputed each poll.
                offset = colab_now - time.time()
                for ts, watts, util in data.get("samples", []):
                    colab_ts = float(ts)
                    if colab_ts <= store.last_colab_ts:
                        continue
                    store.last_colab_ts = colab_ts
                    local_ts = colab_ts - offset
                    w = float(watts)
                    u = float(util)
                    store.add(local_ts, w, u)
                    await bus.publish({
                        "type": "power.sample",
                        "watts": w,
                        "device": store.device,
                        "source": "cloud",
                    })
            except Exception as exc:  # unreachable meter -> keep going, estimate later
                store.reachable = False
                print(f"[power] poll failed ({exc}); will retry")
            await asyncio.sleep(_POLL_INTERVAL_S)


def register(bus, app):
    """Start the 2 Hz sampler against the Colab /power endpoint."""

    @app.on_event("startup")
    async def _start_power_sampler():
        asyncio.create_task(_poll_loop(bus))

    return None

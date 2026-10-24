"""A (PR A2): Power meter. Polls the Colab /power endpoint and integrates energy.

At the Hardware gate we chose Colab T4 as the power source (POWER_SOURCE=cloud).

Contract:
    energy_between(t0, t1) -> (joules: float, source: str)
    source is "measured" (integrated from live Colab watts) or "estimated"
    (fallback), matching answer.completed.energy_source. power.sample events use
    their own source field ("cloud" here).

register(bus, app) starts a 2 Hz sampler that pulls {POWER_URL}/power/history,
converts Colab timestamps to local time, keeps ~20 min of samples in memory, and
emits power.sample events (contracts/events.py). If POWER_URL is unreachable,
energy_between falls back to a gears.json-derived estimate.

Short intervals (a Gear 1 answer is ~0.4 s, shorter than the sample spacing) are
integrated from the piecewise-linear watts curve through the neighbouring
samples, so they can still be "measured" as long as the meter has a reading
within _MAX_GAP_S of both ends and no dropout in between.
"""

from __future__ import annotations

import asyncio
import bisect
import json
import os
import statistics
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

# The engine is started with plain `uvicorn engine.app:app`, which does not read
# .env, so load it here (real environment variables still win).
load_dotenv()

_GEARS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "gears.json"

# Fallback average draw (W) when no live meter is reachable.
_ESTIMATE_WATTS = 60.0

_POLL_INTERVAL_S = 0.5           # poll the Colab history endpoint at 2 Hz
_HISTORY_WINDOW_S = 20 * 60      # keep ~20 minutes of samples
_IDLE_WINDOW_S = 10.0            # measure idle baseline over the first 10 s at util 0
_MAX_GAP_S = 2.0                 # max distance to a sample / between samples to trust a reading


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
    """Integrate watts over [t0, t1] (local time) -> joules, or None if the meter
    does not cover the interval.

    The watts curve is piecewise-linear through the samples. Intervals shorter
    than the sample spacing work: the end values are interpolated between the
    neighbouring samples. Returns None if there is no reading within
    _MAX_GAP_S of either end, or a dropout longer than _MAX_GAP_S inside.
    """
    if t1 <= t0:
        return 0.0
    samples = sorted(store.samples)
    if len(samples) < 1:
        return None
    ts = [s[0] for s in samples]
    ws = [s[1] for s in samples]

    # a reading must exist close to both ends of the interval
    for edge in (t0, t1):
        i = bisect.bisect_left(ts, edge)
        near = min(
            (abs(ts[j] - edge) for j in (i - 1, i) if 0 <= j < len(ts)),
            default=float("inf"),
        )
        if near > _MAX_GAP_S:
            return None

    def watts_at(t: float) -> float:
        i = bisect.bisect_left(ts, t)
        if i <= 0:
            return ws[0]
        if i >= len(ts):
            return ws[-1]
        ta, tb = ts[i - 1], ts[i]
        if tb == ta:
            return ws[i]
        return ws[i - 1] + (ws[i] - ws[i - 1]) * (t - ta) / (tb - ta)

    # knots: the interval ends plus every sample strictly inside it
    knots = [t0] + [t for t in ts if t0 < t < t1] + [t1]
    # Dropout check on the REAL samples that bracket the interval: no gap between
    # consecutive readings overlapping [t0, t1] may exceed _MAX_GAP_S, otherwise
    # we would be interpolating across a hole in the meter data.
    lo = max(0, bisect.bisect_right(ts, t0) - 1)
    hi = min(len(ts) - 1, bisect.bisect_left(ts, t1))
    for k in range(lo, hi):
        if ts[k + 1] - ts[k] > _MAX_GAP_S:
            return None
    idle = store.idle() if subtract_idle else 0.0
    joules = 0.0
    for a, b in zip(knots, knots[1:]):
        wa = max(0.0, watts_at(a) - idle)
        wb = max(0.0, watts_at(b) - idle)
        joules += (wa + wb) / 2.0 * (b - a)
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
                t_send = time.time()
                resp = await client.get(
                    f"{url}/power/history", params={"since": store.last_colab_ts}
                )
                t_recv = time.time()
                resp.raise_for_status()
                data = resp.json()
                store.reachable = True
                store.device = data.get("device", store.device)
                colab_now = float(data["now"])
                # Colab clock vs local clock offset, recomputed each poll. Colab
                # stamped "now" about halfway through the round trip, so compare
                # it with the midpoint, not the arrival time (tunnel RTT is
                # hundreds of ms and would otherwise shift every sample).
                offset = colab_now - (t_send + t_recv) / 2.0
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


_tasks: set = set()  # strong refs: asyncio only keeps weak refs to running tasks


def register(bus, app):
    """Start the 2 Hz sampler against the Colab /power endpoint."""

    @app.on_event("startup")
    async def _start_power_sampler():
        task = asyncio.create_task(_poll_loop(bus))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)

    return None

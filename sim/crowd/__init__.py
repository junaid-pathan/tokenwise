"""sim/crowd — Simulated Massachusetts users (PR B6, owner B, "Simulated").

Simulated users in MA towns replay the held-out prompts so the whole Downshift
loop has traffic. Rate follows the replay load; every prompt is truly ROUTED by
Aru's Triage + Coordinator; 1 in 10 is truly GENERATED, the rest use estimated
energy.

ARCHITECTURE
------------
An outside process cannot publish onto the in-process bus, so the crowd is an
engine-style module exposing `register(bus, app)`. engine/app.py is frozen, so a
one-line `"sim.crowd"` entry in its MODULES list must be added by a joint
contract: PR (see README). Tests/integration call `sim.crowd.register(bus, app)`
explicitly.

LIFECYCLE
---------
The crowd is INERT until grid.load events flow: it starts and stops purely from
the bus. Env switch CROWD_SIM=0 disables it entirely. On each grid.load it:
  1. measures the REAL time since the previous grid.load (self-pacing at any
     replay speed),
  2. draws a Poisson count of prompts for that replay minute from the load
     (sim/crowd/rate.py),
  3. schedules that many prompt.received emissions, jittered over the real
     interval, each from a population-weighted MA town (sim/crowd/towns.py),
     carrying a held-out prompt (sim/crowd/prompts.py).

CLOSING THE LOOP
----------------
Aru's Triage turns prompt.received -> triage.decided (length buckets, since the
event carries `chars` not text); her Coordinator turns that into route.decided
(gear_used, possibly downshifted when the grid is red). We subscribe to
route.decided for OUR prompt_ids only and emit answer.completed so the
Coordinator's report accounting works. 1 in 10 is truly generated
(sim/crowd/realgen.py, falling back to the estimate if the tunnel is down); the
rest use the estimate table (sim/crowd/energy.py).

SECURITY: never print/log secrets or full URLs.

KNOWN LIMITATION: the crowd path is triaged by prompt LENGTH only (prompt.received
carries chars, not text), so its gear mix differs from the held-out B3 labels.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
from typing import Optional

from sim.crowd import energy as energy_mod
from sim.crowd import rate as rate_mod
from sim.crowd import realgen
from sim.crowd.prompts import HeldoutPrompt, load_heldout
from sim.crowd.towns import TownPicker, load_town_picker

# 1 in N prompts is truly generated; the rest use the estimate.
REAL_GENERATION_EVERY = 10

# Safety caps so the sim never exhausts memory / the event loop.
_MAX_INFLIGHT_EMISSIONS = 2000   # scheduled-but-not-yet-emitted prompt tasks
_MAX_INFLIGHT_ANSWERS = 500      # route.decided answers being processed
# A grid.load gap longer than this (real seconds) is treated as a fresh start
# (e.g. a paused/restarted replay), not a real inter-minute interval.
_MAX_REAL_INTERVAL_S = 10.0
# Default assumed real interval before we have measured one (one grid.load seen).
_DEFAULT_REAL_INTERVAL_S = 0.125  # 480 replay s/real s => 60/480 s per minute


def crowd_enabled() -> bool:
    """CROWD_SIM=0 (or false/no/off) disables the crowd; anything else enables."""
    val = os.environ.get("CROWD_SIM", "1").strip().lower()
    return val not in ("0", "false", "no", "off", "")


class CrowdSim:
    """Owns the crowd's state: prompt pool, town picker, pacing, loop closing."""

    def __init__(
        self,
        bus,
        prompts: list[HeldoutPrompt],
        towns: TownPicker,
        *,
        rng: Optional[random.Random] = None,
        monotonic=time.monotonic,
        wall_time=time.time,
    ) -> None:
        self.bus = bus
        self.prompts = prompts
        self.towns = towns
        self.rng = rng or random.Random()
        self._monotonic = monotonic
        self._wall_time = wall_time

        self._seq = 0                      # prompt_id counter -> "crowd-<n>"
        self._real_counter = 0             # every Nth real-generated
        self._last_load_mono: Optional[float] = None
        self._interval_s = _DEFAULT_REAL_INTERVAL_S

        # prompt_ids we own and are still awaiting a route.decided for.
        self._pending: dict[str, HeldoutPrompt] = {}
        self._pending_real: set[str] = set()

        # strong refs to background tasks (asyncio only keeps weak refs).
        self._tasks: set[asyncio.Task] = set()

        # counters for tests / reporting
        self.stats = {
            "minutes_seen": 0,
            "emitted": 0,
            "answered": 0,
            "real_attempts": 0,
            "real_ok": 0,
            "real_fallback": 0,
            "estimated": 0,
            "dropped_backpressure": 0,
            "ignored_routes": 0,
        }

    # --- bus handlers -----------------------------------------------------
    async def on_grid_load(self, ev: dict) -> None:
        """Pace emissions: measure the real interval, draw Poisson, schedule."""
        now = self._monotonic()
        load_mw = float(ev.get("load_mw", 0.0))

        if self._last_load_mono is not None:
            measured = now - self._last_load_mono
            if 0 < measured <= _MAX_REAL_INTERVAL_S:
                self._interval_s = measured
        self._last_load_mono = now
        self.stats["minutes_seen"] += 1

        count = rate_mod.draw_count(load_mw, self.rng)
        if count <= 0:
            return

        interval = self._interval_s
        for _ in range(count):
            if len(self._tasks) >= _MAX_INFLIGHT_EMISSIONS:
                self.stats["dropped_backpressure"] += 1
                continue
            delay = self.rng.random() * interval  # jitter across the interval
            self._spawn(self._emit_after(delay))

    async def _emit_after(self, delay: float) -> None:
        if delay > 0:
            await asyncio.sleep(delay)
        await self._emit_one()

    async def _emit_one(self) -> None:
        """Emit a single prompt.received from a random town + held-out prompt."""
        self._seq += 1
        prompt_id = f"crowd-{self._seq}"
        hp = self.rng.choice(self.prompts)
        town = self.towns.pick(self.rng)

        # back-pressure on answers in flight: if too many, still route but don't
        # grow unboundedly — we simply register it; the cap is a safety net.
        if len(self._pending) < _MAX_INFLIGHT_ANSWERS:
            self._pending[prompt_id] = hp
            # decide real-vs-estimate deterministically round-robin (1 in N).
            self._real_counter += 1
            if self._real_counter % REAL_GENERATION_EVERY == 0:
                self._pending_real.add(prompt_id)
        else:
            self.stats["dropped_backpressure"] += 1

        self.stats["emitted"] += 1
        await self.bus.publish({
            "type": "prompt.received",
            "prompt_id": prompt_id,
            "source": "crowd",
            "chars": hp.chars,
            "town": town,
        })

    async def on_route_decided(self, ev: dict) -> None:
        """Close the loop for OUR prompt_ids only -> emit answer.completed."""
        pid = ev.get("prompt_id")
        hp = self._pending.pop(pid, None)
        if hp is None:
            # not ours (extension/api prompt, or already handled) -> ignore.
            self.stats["ignored_routes"] += 1
            return

        want_real = pid in self._pending_real
        self._pending_real.discard(pid)
        gear_used = int(ev.get("gear_used", 1))

        # process off the hot path so we never block the publish fan-out.
        self._spawn(self._complete(pid, hp, gear_used, want_real))

    async def _complete(
        self, pid: str, hp: HeldoutPrompt, gear_used: int, want_real: bool
    ) -> None:
        latency_ms = 0
        output_tokens = energy_mod._REFERENCE_OUTPUT_TOKENS
        energy_source = "estimated"
        energy_j = 0.0

        if want_real and gear_used in realgen.REAL_GEARS:
            self.stats["real_attempts"] += 1
            t0 = self._wall_time()
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(realgen.generate_real, gear_used, hp.prompt),
                    timeout=realgen.REAL_MAX_TOKENS,  # seconds budget, short
                )
            except Exception:
                result = realgen.RealResult(
                    ok=False, latency_ms=0, output_tokens=0, model="", error="timeout"
                )
            t1 = self._wall_time()

            if result.ok:
                self.stats["real_ok"] += 1
                latency_ms = result.latency_ms
                output_tokens = max(1, result.output_tokens)
                # Prefer a live meter if it covered the window.
                energy_j, energy_source = self._energy_around(t0, t1, gear_used, output_tokens)
            else:
                self.stats["real_fallback"] += 1
                energy_j = energy_mod.estimate_joules(gear_used, output_tokens)
                energy_source = "estimated"
        else:
            self.stats["estimated"] += 1
            energy_j = energy_mod.estimate_joules(gear_used, output_tokens)
            energy_source = "estimated"
            latency_ms = _estimate_latency_ms(gear_used)

        self.stats["answered"] += 1
        await self.bus.publish({
            "type": "answer.completed",
            "prompt_id": pid,
            "gear_used": gear_used,
            "latency_ms": int(latency_ms),
            "output_tokens": int(output_tokens),
            "energy_j": round(float(energy_j), 2),
            "energy_source": energy_source,
        })

    def _energy_around(self, t0: float, t1: float, gear: int, tokens: int):
        """Use engine.power.energy_between if available/covering, else estimate."""
        try:
            from engine import power
            joules, source = power.energy_between(t0, t1)
            if source == "measured" and joules > 0:
                return joules, "measured"
        except Exception:
            pass
        return energy_mod.estimate_joules(gear, tokens), "estimated"

    # --- task bookkeeping -------------------------------------------------
    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @property
    def inflight(self) -> int:
        return len(self._tasks)

    async def aclose(self) -> None:
        """Cancel outstanding tasks (used in tests)."""
        for task in list(self._tasks):
            if not task.done():
                task.cancel()
        for task in list(self._tasks):
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()


def _estimate_latency_ms(gear: int) -> int:
    """A small deterministic placeholder latency for estimated answers (ms)."""
    return {1: 300, 2: 500, 3: 900, 4: 1800, 5: 4000}.get(int(gear), 800)


def register(bus, app=None):
    """Engine-style entry point. Subscribes the crowd to the bus.

    Inert (returns None, subscribes nothing) when CROWD_SIM=0 or when the
    held-out prompts are unavailable. The crowd only acts once grid.load events
    flow, so merely registering it has no effect until a replay runs.
    """
    if not crowd_enabled():
        print("[crowd] CROWD_SIM=0: simulated users disabled")
        return None

    try:
        prompts = load_heldout()
    except Exception as exc:
        print(f"[crowd] disabled: cannot load held-out prompts ({type(exc).__name__})")
        return None

    towns = load_town_picker()
    sim = CrowdSim(bus, prompts, towns)

    bus.subscribe("grid.load", sim.on_grid_load)
    bus.subscribe("route.decided", sim.on_route_decided)

    if app is not None:
        app.state.crowd_sim = sim
    print(
        f"[crowd] simulated users ready "
        f"({len(prompts)} held-out prompts, {len(towns)} towns, {towns.source})"
    )
    return sim

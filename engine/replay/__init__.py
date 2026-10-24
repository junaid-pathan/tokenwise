"""B (PR B1): June 24, 2025 replay clock.

Loads the cached EIA hourly New England demand (data/grid/june24.json),
interpolates to 1440 per-minute points, and publishes one `grid.load` event per
replay minute on the bus. Aru's Grid agent turns each into a `grid.state` level.

POST /v1/demo/replay {date, speed} starts (or restarts) the replay.

Speed unit (per contracts/api.md fix, separate PR #11): speed = replay SECONDS
per real second. Default 480 => 86,400 replay s / 480 = 180 real s = 3 min for
the full 24 h day. One replay minute (60 replay s) therefore takes 60/speed real
seconds.

Pacing is drift-corrected: every minute's deadline is computed from a single
monotonic start time (start + k * interval), never by chaining sleeps, so the
clock does not accumulate drift. The loop runs as an asyncio background task and
only ever awaits, so it never blocks the event loop.
"""

from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable, Optional

from pydantic import BaseModel, Field

from engine.replay.interpolate import (
    MINUTES_PER_DAY,
    hourly_loads,
    interpolate_to_minutes,
    load_cache,
    minute_clock,
)

SUPPORTED_DATE = "2025-06-24"
DEFAULT_SPEED = 480.0          # replay seconds per real second
MAX_SPEED = 20000.0
REPLAY_SECONDS_PER_MINUTE = 60.0


class ReplayBody(BaseModel):
    """Body for POST /v1/demo/replay. MODULE level so FastAPI parses it."""

    date: str = Field(default=SUPPORTED_DATE, description="Only 2025-06-24 supported.")
    speed: float = Field(
        default=DEFAULT_SPEED,
        gt=0,
        le=MAX_SPEED,
        description="Replay seconds per real second (default 480).",
    )


def real_seconds_per_minute(speed: float) -> float:
    """Real seconds each replay minute should take at the given speed."""
    return REPLAY_SECONDS_PER_MINUTE / speed


def duration_seconds(speed: float, minutes: int = MINUTES_PER_DAY) -> float:
    """Total real seconds for `minutes` replay minutes at the given speed."""
    return minutes * real_seconds_per_minute(speed)


class ReplayClock:
    """Publishes one grid.load per replay minute, drift-corrected.

    `monotonic` and `sleep` are injectable so tests can drive a fake clock.
    `sleep` receives the number of real seconds to wait (may be <= 0).
    """

    def __init__(
        self,
        bus,
        loads: list[float],
        date_iso: str = SUPPORTED_DATE,
        *,
        monotonic: Callable[[], float] = None,
        sleep: Callable[[float], Awaitable[None]] = None,
    ) -> None:
        if len(loads) != MINUTES_PER_DAY:
            raise ValueError(
                f"expected {MINUTES_PER_DAY} per-minute loads, got {len(loads)}"
            )
        self.bus = bus
        self.loads = loads
        self.date_iso = date_iso
        self._monotonic = monotonic or time.monotonic
        self._sleep = sleep or asyncio.sleep

    def event_for(self, minute: int) -> dict:
        """Build the grid.load event dict for a replay minute (no id/ts)."""
        return {
            "type": "grid.load",
            "load_mw": self.loads[minute],
            "replay_clock": minute_clock(minute, self.date_iso),
            "source": "replay",
        }

    async def run(self, speed: float) -> None:
        """Publish all 1440 minutes, paced from a single monotonic start time."""
        interval = real_seconds_per_minute(speed)
        start = self._monotonic()
        for minute in range(MINUTES_PER_DAY):
            # Drift-corrected: deadline is start + minute*interval, not a chain.
            deadline = start + minute * interval
            wait = deadline - self._monotonic()
            if wait > 0:
                await self._sleep(wait)
            await self.bus.publish(self.event_for(minute))


class ReplayController:
    """Owns the single in-flight replay task; starting cancels the old one."""

    def __init__(self, bus) -> None:
        self.bus = bus
        self._task: Optional[asyncio.Task] = None
        self._loads: Optional[list[float]] = None

    def _ensure_loads(self) -> list[float]:
        if self._loads is None:
            self._loads = interpolate_to_minutes(hourly_loads(load_cache()))
        return self._loads

    async def cancel(self) -> None:
        """Cancel any running replay and await its teardown."""
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def start(self, date_iso: str, speed: float) -> dict:
        """Cancel any running replay, then start a fresh one. Returns summary."""
        await self.cancel()
        loads = self._ensure_loads()
        clock = ReplayClock(self.bus, loads, date_iso)
        self._task = asyncio.create_task(clock.run(speed))
        return {
            "status": "started",
            "date": date_iso,
            "speed": speed,
            "minutes": MINUTES_PER_DAY,
            "duration_s": round(duration_seconds(speed), 3),
        }


def register(bus, app):
    """Wire POST /v1/demo/replay and the replay controller into the app."""
    from fastapi import HTTPException

    controller = ReplayController(bus)

    @app.post("/v1/demo/replay")
    async def post_replay(body: ReplayBody) -> dict:
        if body.date != SUPPORTED_DATE:
            raise HTTPException(
                status_code=400,
                detail=f"only {SUPPORTED_DATE} is supported, got {body.date!r}",
            )
        # speed bounds (>0, <=20000) are enforced by the Pydantic model (422).
        return await controller.start(body.date, body.speed)

    # Expose for tests/introspection.
    app.state.replay_controller = controller
    return controller

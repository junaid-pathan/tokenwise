"""Unit tests for the ReplayClock: event stream, order, pacing with a fake clock."""

from __future__ import annotations

import pytest

from engine.replay import (
    DEFAULT_SPEED,
    MINUTES_PER_DAY,
    ReplayClock,
    duration_seconds,
    real_seconds_per_minute,
)
from engine.replay.interpolate import hourly_loads, interpolate_to_minutes, load_cache


class CollectBus:
    """Minimal bus stand-in that records published events."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    async def publish(self, event: dict) -> None:
        self.events.append(event)


class FakeTime:
    """Deterministic monotonic clock + sleep that advances it by the waited amount."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        if seconds > 0:
            self.now += seconds


def _loads() -> list[float]:
    return interpolate_to_minutes(hourly_loads(load_cache()))


# --- pacing math (no I/O) --------------------------------------------------

def test_real_seconds_per_minute_default():
    # 60 replay seconds / 480 = 0.125 real seconds per replay minute
    assert real_seconds_per_minute(DEFAULT_SPEED) == pytest.approx(0.125)


def test_duration_default_is_180s():
    # full day in 3 minutes at the default speed
    assert duration_seconds(DEFAULT_SPEED) == pytest.approx(180.0)


def test_duration_scales_with_speed():
    assert duration_seconds(14400) == pytest.approx(86400 / 14400)  # == 6.0s
    assert duration_seconds(240) == pytest.approx(360.0)


# --- event stream ----------------------------------------------------------

@pytest.mark.asyncio
async def test_emits_exactly_1440_events():
    bus = CollectBus()
    ft = FakeTime()
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    await clock.run(DEFAULT_SPEED)
    assert len(bus.events) == MINUTES_PER_DAY


@pytest.mark.asyncio
async def test_events_have_exact_field_names():
    bus = CollectBus()
    ft = FakeTime()
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    await clock.run(DEFAULT_SPEED)
    ev = bus.events[960]  # minute 960 == 16:00 local
    assert set(ev.keys()) == {"type", "load_mw", "replay_clock", "source"}
    assert ev["type"] == "grid.load"
    assert ev["source"] == "replay"
    assert ev["replay_clock"] == "2025-06-24T16:00:00"
    assert isinstance(ev["load_mw"], float)


@pytest.mark.asyncio
async def test_events_in_minute_order():
    bus = CollectBus()
    ft = FakeTime()
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    await clock.run(DEFAULT_SPEED)
    clocks = [e["replay_clock"] for e in bus.events]
    assert clocks[0] == "2025-06-24T00:00:00"
    assert clocks[-1] == "2025-06-24T23:59:00"
    assert clocks == sorted(clocks)  # lexicographic == chronological here


@pytest.mark.asyncio
async def test_peak_matches_real_peak():
    bus = CollectBus()
    ft = FakeTime()
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    await clock.run(DEFAULT_SPEED)
    peak = max(bus.events, key=lambda e: e["load_mw"])
    assert peak["load_mw"] == pytest.approx(25898.0)
    assert peak["replay_clock"] == "2025-06-24T19:00:00"


# --- pacing with the fake clock -------------------------------------------

@pytest.mark.asyncio
async def test_pacing_is_drift_corrected():
    """With a fake clock that advances exactly by each sleep, every minute after
    the first waits one interval, so total elapsed == (n-1) intervals and no
    drift accumulates. Minute 0's deadline == start, so its wait is 0 and no
    sleep is issued for it."""
    bus = CollectBus()
    ft = FakeTime()
    speed = 480.0
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    start = ft.now
    await clock.run(speed)
    interval = real_seconds_per_minute(speed)
    # Minute 0 waits 0 (no sleep); minutes 1..1439 each wait one interval.
    assert len(ft.sleeps) == MINUTES_PER_DAY - 1
    assert all(s == pytest.approx(interval) for s in ft.sleeps)
    elapsed = ft.now - start
    assert elapsed == pytest.approx(duration_seconds(speed) - interval)


@pytest.mark.asyncio
async def test_scheduling_formula_catches_up_after_stall():
    """The drift-correction formula (deadline = start + k*interval) yields
    negative waits after a stall, meaning the clock catches up rather than
    drifting forward. Verified directly against the formula."""
    speed = 480.0
    interval = real_seconds_per_minute(speed)
    start = 0.0
    now = start
    waits: list[float] = []
    for minute in range(10):
        deadline = start + minute * interval
        wait = deadline - now
        waits.append(wait)
        if wait > 0:
            now += wait
        # Stall for 10 intervals right after minute 2.
        if minute == 2:
            now += 10 * interval
    # Minutes 3..  should have negative waits (deadlines already passed).
    assert any(w < 0 for w in waits), waits


@pytest.mark.asyncio
async def test_run_completes_all_events_despite_stall():
    """Even when the monotonic clock jumps forward mid-run (a real stall),
    run() still publishes exactly 1440 events and never hangs."""
    bus = CollectBus()

    class StallTime:
        def __init__(self) -> None:
            self.now = 500.0
            self._stalled = False
            self.sleeps = 0

        def monotonic(self) -> float:
            # Jump 5 seconds forward exactly once, on the 3rd reading.
            self.now += 0.0001
            if not self._stalled and self.sleeps == 1:
                self._stalled = True
                self.now += 5.0
            return self.now

        async def sleep(self, seconds: float) -> None:
            self.sleeps += 1
            if seconds > 0:
                self.now += seconds

    ft = StallTime()
    clock = ReplayClock(bus, _loads(), monotonic=ft.monotonic, sleep=ft.sleep)
    await clock.run(480.0)
    assert len(bus.events) == MINUTES_PER_DAY


@pytest.mark.asyncio
async def test_clock_rejects_wrong_load_length():
    bus = CollectBus()
    with pytest.raises(ValueError):
        ReplayClock(bus, [1.0, 2.0])

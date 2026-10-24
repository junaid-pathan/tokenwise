"""Unit tests: CrowdSim loop behaviour (PR B6).

These use a tiny fake bus (no engine import needed) and a controlled RNG/clock so
the pacing, 1-in-10 selection, loop-closing, fallback, foreign-id ignoring,
bounded memory and CROWD_SIM=0 inertness are all deterministic.
"""

from __future__ import annotations

import asyncio
import random

import pytest

import sim.crowd as crowd
from sim.crowd import CrowdSim, crowd_enabled, register
from sim.crowd.prompts import HeldoutPrompt
from sim.crowd.towns import load_town_picker


class FakeBus:
    """Minimal async pub/sub that records events and fans out to subscribers."""

    def __init__(self):
        self.events = []
        self._subs = {}

    def subscribe(self, etype, handler):
        self._subs.setdefault(etype, []).append(handler)

    async def publish(self, event):
        self.events.append(event)
        for h in self._subs.get(event["type"], []):
            await h(event)

    def of(self, etype):
        return [e for e in self.events if e["type"] == etype]


def _prompts(n=10):
    return [HeldoutPrompt(prompt="x" * (i + 5), source="test", gear=1) for i in range(n)]


def _sim(bus, *, seed=0, monotonic=None):
    towns = load_town_picker()
    return CrowdSim(
        bus,
        _prompts(),
        towns,
        rng=random.Random(seed),
        monotonic=monotonic or (lambda: 0.0),
    )


async def _drain():
    """Let scheduled asyncio tasks run to completion."""
    for _ in range(10):
        await asyncio.sleep(0)


# --- inertness --------------------------------------------------------------

def test_crowd_sim_env_toggle(monkeypatch):
    monkeypatch.setenv("CROWD_SIM", "0")
    assert crowd_enabled() is False
    monkeypatch.setenv("CROWD_SIM", "1")
    assert crowd_enabled() is True
    monkeypatch.delenv("CROWD_SIM", raising=False)
    assert crowd_enabled() is True


def test_register_inert_when_disabled(monkeypatch):
    monkeypatch.setenv("CROWD_SIM", "0")
    bus = FakeBus()
    sim = register(bus, None)
    assert sim is None
    assert bus._subs == {}  # nothing subscribed


async def test_no_grid_load_means_no_emissions():
    """Inert until grid.load flows: with no grid.load, nothing is emitted."""
    bus = FakeBus()
    sim = _sim(bus)
    await _drain()
    assert sim.stats["emitted"] == 0
    assert bus.of("prompt.received") == []


# --- pacing / emission ------------------------------------------------------

async def test_grid_load_emits_prompts():
    bus = FakeBus()
    # clock advances 0.125 s per grid.load so interval is measured.
    ticks = iter([0.0, 0.125, 0.25, 0.375, 0.5] + [1.0] * 50)
    sim = _sim(bus, seed=5, monotonic=lambda: next(ticks))
    # high load so Poisson mean is a few per minute; zero jitter delay via rng?
    for _ in range(20):
        await sim.on_grid_load({"type": "grid.load", "load_mw": 21000.0})
    await _drain()
    received = bus.of("prompt.received")
    assert len(received) > 0
    for ev in received:
        assert ev["source"] == "crowd"
        assert ev["prompt_id"].startswith("crowd-")
        assert ev["chars"] > 0
        assert sim.towns.is_valid(ev["town"])


async def test_prompt_ids_are_unique():
    bus = FakeBus()
    sim = _sim(bus, seed=9)
    for _ in range(30):
        await sim.on_grid_load({"type": "grid.load", "load_mw": 26000.0})
    await _drain()
    ids = [e["prompt_id"] for e in bus.of("prompt.received")]
    assert len(ids) == len(set(ids))


# --- 1-in-10 selection ------------------------------------------------------

async def test_one_in_ten_marked_real(monkeypatch):
    bus = FakeBus()
    sim = _sim(bus)
    # Emit exactly 100 prompts directly.
    for _ in range(100):
        await sim._emit_one()
    # Every 10th emission is flagged real; 100 emissions -> 10 real.
    # _pending_real only holds ids not yet routed; count via the counter logic:
    real_ids = [pid for pid in sim._pending if pid in sim._pending_real]
    assert len(real_ids) == 10


# --- loop closing -----------------------------------------------------------

async def test_route_decided_closes_loop_with_estimate():
    bus = FakeBus()
    sim = _sim(bus)
    bus.subscribe("route.decided", sim.on_route_decided)
    await sim._emit_one()  # crowd-1, estimated (not a 10th)
    pid = "crowd-1"
    await bus.publish({"type": "route.decided", "prompt_id": pid, "gear_used": 2,
                       "gear_needed": 2, "model": "m", "reason": "r"})
    await _drain()
    answers = bus.of("answer.completed")
    assert len(answers) == 1
    a = answers[0]
    assert a["prompt_id"] == pid
    assert a["gear_used"] == 2
    assert a["energy_source"] == "estimated"
    assert a["energy_j"] > 0
    assert a["output_tokens"] > 0


async def test_route_decided_for_foreign_id_is_ignored():
    bus = FakeBus()
    sim = _sim(bus)
    bus.subscribe("route.decided", sim.on_route_decided)
    await bus.publish({"type": "route.decided", "prompt_id": "a-deadbeef",
                       "gear_used": 3, "gear_needed": 3, "model": "m", "reason": "r"})
    await _drain()
    assert bus.of("answer.completed") == []
    assert sim.stats["ignored_routes"] == 1


async def test_real_generation_failure_falls_back(monkeypatch):
    bus = FakeBus()
    sim = _sim(bus)
    bus.subscribe("route.decided", sim.on_route_decided)

    # Force real generation to fail -> fallback to estimate, still counted.
    from sim.crowd import realgen

    def boom(gear, prompt, max_tokens=64):
        return realgen.RealResult(ok=False, latency_ms=0, output_tokens=0,
                                  model="", error="ConnectError")

    monkeypatch.setattr(realgen, "generate_real", boom)

    await sim._emit_one()
    pid = "crowd-1"
    sim._pending_real.add(pid)  # force this one to attempt real
    await bus.publish({"type": "route.decided", "prompt_id": pid, "gear_used": 2,
                       "gear_needed": 2, "model": "m", "reason": "r"})
    await _drain()
    answers = bus.of("answer.completed")
    assert len(answers) == 1
    assert answers[0]["energy_source"] == "estimated"
    assert sim.stats["real_attempts"] == 1
    assert sim.stats["real_fallback"] == 1
    assert sim.stats["real_ok"] == 0


async def test_real_generation_success_reports_real(monkeypatch):
    bus = FakeBus()
    sim = _sim(bus)
    bus.subscribe("route.decided", sim.on_route_decided)
    from sim.crowd import realgen

    def ok(gear, prompt, max_tokens=64):
        return realgen.RealResult(ok=True, latency_ms=123, output_tokens=40, model="m")

    monkeypatch.setattr(realgen, "generate_real", ok)

    await sim._emit_one()
    pid = "crowd-1"
    sim._pending_real.add(pid)
    await bus.publish({"type": "route.decided", "prompt_id": pid, "gear_used": 3,
                       "gear_needed": 3, "model": "m", "reason": "r"})
    await _drain()
    a = bus.of("answer.completed")[0]
    assert a["latency_ms"] == 123
    assert a["output_tokens"] == 40
    assert sim.stats["real_ok"] == 1


async def test_measured_energy_used_when_meter_covers(monkeypatch):
    """On a real success with a live meter reporting 'measured', report it."""
    bus = FakeBus()
    sim = _sim(bus)
    bus.subscribe("route.decided", sim.on_route_decided)
    from sim.crowd import realgen
    import engine.power as power

    monkeypatch.setattr(
        realgen, "generate_real",
        lambda g, p, max_tokens=64: realgen.RealResult(ok=True, latency_ms=55,
                                                       output_tokens=30, model="m"),
    )
    monkeypatch.setattr(power, "energy_between", lambda t0, t1: (777.0, "measured"))

    await sim._emit_one()
    pid = "crowd-1"
    sim._pending_real.add(pid)
    await bus.publish({"type": "route.decided", "prompt_id": pid, "gear_used": 2,
                       "gear_needed": 2, "model": "m", "reason": "r"})
    await _drain()
    a = bus.of("answer.completed")[0]
    assert a["energy_source"] == "measured"
    assert a["energy_j"] == 777.0


# --- bounded memory ---------------------------------------------------------

async def test_bounded_inflight_emissions():
    bus = FakeBus()
    sim = _sim(bus, seed=1)
    # Monkey-patch the cap low and slow the emit so tasks pile up.
    crowd._MAX_INFLIGHT_EMISSIONS  # ensure attr exists
    sim._interval_s = 100.0  # big jitter delays -> emissions stay pending
    # Many high-load minutes at once.
    for _ in range(50):
        await sim.on_grid_load({"type": "grid.load", "load_mw": 26000.0})
    # inflight tasks must never exceed the cap.
    assert sim.inflight <= crowd._MAX_INFLIGHT_EMISSIONS
    await sim.aclose()


async def test_pending_answers_are_bounded():
    bus = FakeBus()
    sim = _sim(bus)
    # Emit way more than the answer cap without routing any.
    for _ in range(crowd._MAX_INFLIGHT_ANSWERS + 200):
        await sim._emit_one()
    assert len(sim._pending) <= crowd._MAX_INFLIGHT_ANSWERS
    assert sim.stats["dropped_backpressure"] >= 200

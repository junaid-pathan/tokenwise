"""Tests for the Coordinator (A6 policy + A7 negotiation)."""

from __future__ import annotations

import asyncio

from fastapi import FastAPI

from engine.agents.coordinator import REPORT_EVERY, register


class FakeBus:
    def __init__(self) -> None:
        self.handlers: dict[str, list] = {}
        self.published: list[dict] = []

    def subscribe(self, event_type, handler) -> None:
        self.handlers.setdefault(event_type, []).append(handler)

    async def publish(self, event: dict) -> None:
        self.published.append(event)

    def send(self, event: dict) -> None:
        for h in self.handlers.get(event["type"], []):
            asyncio.run(h(event))

    def last(self, event_type: str) -> dict:
        return [e for e in self.published if e["type"] == event_type][-1]


def _bus() -> FakeBus:
    bus = FakeBus()
    register(bus, FastAPI())
    return bus


def _grid(bus, level):
    bus.send({"type": "grid.state", "level": level})


def _triage(bus, pid, gear, conf=0.8, **extra):
    bus.send({"type": "triage.decided", "prompt_id": pid, "gear_needed": gear,
              "confidence": conf, "reason": "t", **extra})
    return bus.last("route.decided")


def test_policy_table():
    bus = _bus()
    assert _triage(bus, "g", 3)["gear_used"] == 3            # green keeps gear
    _grid(bus, "yellow")
    assert _triage(bus, "y", 3)["gear_used"] == 3            # yellow keeps gear
    _grid(bus, "red")
    assert _triage(bus, "r1", 3, 0.8)["gear_used"] == 2      # red, confident: down one
    assert _triage(bus, "r2", 3, 0.4)["gear_used"] == 3      # red, low confidence: keep
    assert _triage(bus, "r3", 1, 0.9)["gear_used"] == 1      # floor at Gear 1
    assert _triage(bus, "r4", 4, 0.9, protected=True)["gear_used"] == 4  # protected never shifts


def test_route_decided_uses_gears_json_model():
    bus = _bus()
    assert _triage(bus, "p", 1)["model"] == "qwen2.5:0.5b"


def test_nothing_is_marked_deferred_during_a_cut_request():
    bus = _bus()
    _grid(bus, "red")
    bus.send({"type": "utility.request", "request_id": "r-1", "cut_pct": 25.0,
              "duration_min": 120, "reason": "x"})
    assert _triage(bus, "p", 3)["deferred"] is False


def test_commit_then_report_after_n_answers():
    bus = _bus()
    _grid(bus, "red")
    bus.send({"type": "utility.request", "request_id": "r-1", "cut_pct": 25.0,
              "duration_min": 120, "reason": "x"})
    commit = bus.last("coordinator.commit")
    assert commit["request_id"] == "r-1" and commit["committed_cut_pct"] == 25.0
    assert commit["policy"] == {"gear_offset": -1, "defer_batch": True, "protect_critical": True}

    for i in range(REPORT_EVERY):
        _triage(bus, f"a{i}", 4)  # needed 4, shifted to 3
        bus.send({"type": "answer.completed", "prompt_id": f"a{i}", "gear_used": 3,
                  "latency_ms": 1, "output_tokens": 1, "energy_j": 30.0,
                  "energy_source": "estimated"})
    rep = bus.last("coordinator.report")
    assert rep["request_id"] == "r-1"
    assert rep["achieved_cut_pct"] == 25.0
    assert (rep["joules_baseline"], rep["joules_actual"]) == (200.0, 150.0)


def test_no_report_without_active_request():
    bus = _bus()
    bus.send({"type": "answer.completed", "prompt_id": "x", "gear_used": 2, "latency_ms": 1,
              "output_tokens": 1, "energy_j": 5.0, "energy_source": "estimated"})
    assert not [e for e in bus.published if e["type"] == "coordinator.report"]

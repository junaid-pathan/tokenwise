"""Tests for the B4 Utility agent (deterministic negotiator).

Run from the worktree root:
    C:\\Users\\user\\Documents\\sip\\.venv\\Scripts\\python.exe -m pytest engine/agents/utility -v

Covers the PRD "Done when": against fixture commit/report events it accepts or
flags a shortfall, plus the escalation / no-spam / manual-endpoint rules.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from contracts.events import UtilityRequest, UtilityVerdict
from engine.agents.utility import (
    AUTO_CUT_PCT,
    AUTO_DURATION_MIN,
    MAX_CUT_PCT,
    UtilityAgent,
    register,
)

_FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures"


# --- a tiny in-memory bus that records every published event ---------------

class FakeBus:
    """Minimal stand-in for engine.bus.Bus: records events, fans out to subs."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self._subs: dict[str, list] = {}

    def subscribe(self, event_type: str, handler) -> None:
        self._subs.setdefault(event_type, []).append(handler)

    async def publish(self, event: dict) -> None:
        self.events.append(event)

    def of_type(self, event_type: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == event_type]


def _load_fixture(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


def _red_state() -> dict:
    return {"type": "grid.state", "level": "red", "load_mw": 24180.0,
            "replay_clock": "2025-06-24T16:00:00", "source": "replay"}


def _green_state() -> dict:
    return {"type": "grid.state", "level": "green", "load_mw": 15000.0,
            "replay_clock": "2025-06-24T04:00:00", "source": "replay"}


def _validates(event: dict, model) -> None:
    """Round-trip through the frozen contract model to lock field names/shape."""
    model.model_validate(event)


# --- grid.state triggering --------------------------------------------------

async def test_red_once_emits_no_request() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    assert bus.of_type("utility.request") == []
    assert agent.active_request_id is None


async def test_red_twice_emits_exactly_one_request() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    reqs = bus.of_type("utility.request")
    assert len(reqs) == 1
    req = reqs[0]
    assert req["cut_pct"] == AUTO_CUT_PCT == 25.0
    assert req["duration_min"] == AUTO_DURATION_MIN == 120
    assert req["reason"] == "grid red for 2 samples"
    _validates(req, UtilityRequest)


async def test_red_many_times_still_one_active_request() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    for _ in range(5):
        await agent.on_grid_state(_red_state())
    assert len(bus.of_type("utility.request")) == 1  # no spam


async def test_non_red_resets_and_allows_new_request() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())      # request #1
    await agent.on_grid_state(_green_state())    # recovery frees the slot
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())      # request #2
    assert len(bus.of_type("utility.request")) == 2


# --- coordinator.report verdicts (fixture-driven) ---------------------------

async def test_report_within_tolerance_is_accepted() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    req_id = agent.active_request_id

    # fixture: achieved 24.3 vs requested 25 -> shortfall 0.7 <= 3 -> accepted
    report = _load_fixture("coordinator.report.json")
    report["request_id"] = req_id
    await agent.on_report(report)

    verdicts = bus.of_type("utility.verdict")
    assert len(verdicts) == 1
    v = verdicts[0]
    assert v["accepted"] is True
    assert v["shortfall_pct"] == pytest.approx(0.7, abs=1e-6)
    _validates(v, UtilityVerdict)
    assert agent.active_request_id is None  # resolved


async def test_commit_is_recorded_from_fixture() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    req_id = agent.active_request_id

    commit = _load_fixture("coordinator.commit.json")
    commit["request_id"] = req_id
    await agent.on_commit(commit)
    assert agent.committed_cut_pct == 25.0


async def test_shortfall_rejects_then_escalates_once() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    first_id = agent.active_request_id

    # achieved 20 vs requested 25 -> shortfall 5 > 3 -> reject + escalate
    await agent.on_report({"type": "coordinator.report", "request_id": first_id,
                           "achieved_cut_pct": 20.0, "joules_baseline": 1000.0,
                           "joules_actual": 800.0})

    verdicts = bus.of_type("utility.verdict")
    assert len(verdicts) == 1
    assert verdicts[0]["accepted"] is False
    assert verdicts[0]["shortfall_pct"] == pytest.approx(5.0)

    reqs = bus.of_type("utility.request")
    assert len(reqs) == 2  # original + one escalation
    escalated = reqs[1]
    # escalation rule: cut_pct = min(50, requested + shortfall) = min(50, 25+5) = 30
    assert escalated["cut_pct"] == 30.0
    assert escalated["duration_min"] == AUTO_DURATION_MIN
    assert escalated["request_id"] != first_id
    assert agent.active_request_id == escalated["request_id"]


async def test_second_shortfall_is_final_no_third_request() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    first_id = agent.active_request_id

    await agent.on_report({"type": "coordinator.report", "request_id": first_id,
                           "achieved_cut_pct": 20.0, "joules_baseline": 1000.0,
                           "joules_actual": 800.0})
    esc_id = agent.active_request_id  # the escalated request

    # second shortfall on the escalated request -> final verdict, NO re-request
    await agent.on_report({"type": "coordinator.report", "request_id": esc_id,
                           "achieved_cut_pct": 10.0, "joules_baseline": 1000.0,
                           "joules_actual": 900.0})

    assert len(bus.of_type("utility.request")) == 2  # no third request
    verdicts = bus.of_type("utility.verdict")
    assert len(verdicts) == 2
    assert verdicts[-1]["accepted"] is False
    assert verdicts[-1]["shortfall_pct"] == pytest.approx(20.0)  # 30 - 10
    assert agent.active_request_id is None  # resolved after final verdict


async def test_escalation_cut_is_capped_at_max() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    first_id = agent.active_request_id

    # requested 25, achieved 0 -> shortfall 25 -> 25+25 = 50 (not over the cap)
    await agent.on_report({"type": "coordinator.report", "request_id": first_id,
                           "achieved_cut_pct": 0.0, "joules_baseline": 1000.0,
                           "joules_actual": 1000.0})
    escalated = bus.of_type("utility.request")[1]
    assert escalated["cut_pct"] == MAX_CUT_PCT == 50.0


async def test_report_for_unknown_request_is_ignored() -> None:
    bus = FakeBus()
    agent = UtilityAgent(bus)
    await agent.on_grid_state(_red_state())
    await agent.on_grid_state(_red_state())
    await agent.on_report({"type": "coordinator.report", "request_id": "r-999",
                           "achieved_cut_pct": 0.0, "joules_baseline": 1.0,
                           "joules_actual": 1.0})
    assert bus.of_type("utility.verdict") == []


# --- manual HTTP endpoint ---------------------------------------------------

def _client_with_agent() -> TestClient:
    app = FastAPI()
    bus = FakeBus()
    agent = register(bus, app)
    app.state.test_bus = bus
    app.state.test_agent = agent
    return TestClient(app)


def test_manual_request_valid_returns_request_id() -> None:
    client = _client_with_agent()
    resp = client.post("/v1/utility/request", json={"cut_pct": 30, "duration_min": 60})
    assert resp.status_code == 200
    body = resp.json()
    assert "request_id" in body
    bus = client.app.state.test_bus
    reqs = bus.of_type("utility.request")
    assert len(reqs) == 1
    assert reqs[0]["cut_pct"] == 30.0
    assert reqs[0]["duration_min"] == 60
    _validates(reqs[0], UtilityRequest)


@pytest.mark.parametrize("payload", [
    {"cut_pct": -1, "duration_min": 60},     # cut too low
    {"cut_pct": 101, "duration_min": 60},    # cut too high
    {"cut_pct": 30, "duration_min": 0},      # duration not > 0
    {"cut_pct": 30, "duration_min": -5},     # negative duration
])
def test_manual_request_invalid_is_rejected(payload) -> None:
    client = _client_with_agent()
    resp = client.post("/v1/utility/request", json=payload)
    assert resp.status_code == 422


def test_manual_request_bounds_are_inclusive() -> None:
    client = _client_with_agent()
    assert client.post("/v1/utility/request",
                       json={"cut_pct": 0, "duration_min": 1}).status_code == 200
    assert client.post("/v1/utility/request",
                       json={"cut_pct": 100, "duration_min": 1}).status_code == 200


# --- whole-app boot (register works against the real app + bus) -------------

def test_full_app_boot_registers_utility_agent() -> None:
    import os

    os.environ.setdefault("DOWNSHIFT_MOCK", "0")
    from engine.app import app as real_app

    with TestClient(real_app) as client:  # runs the startup -> _register_all
        health = client.get("/health")
        assert health.status_code == 200
        # register() stored the agent on app.state during startup
        assert isinstance(real_app.state.utility_agent, UtilityAgent)
        # the real POST route is wired and validates input
        ok = client.post("/v1/utility/request",
                         json={"cut_pct": 25, "duration_min": 120})
        assert ok.status_code == 200
        assert "request_id" in ok.json()
        bad = client.post("/v1/utility/request",
                          json={"cut_pct": 200, "duration_min": 120})
        assert bad.status_code == 422

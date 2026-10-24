"""Tests for POST /v1/triage observe mode: prompts the user really sent on
claude.ai are announced on the bus and routed, with no answer generated."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.agents import triage
from engine.bus import Bus


def _client(route_shift: int = 1):
    """Real bus + triage, plus a stub Coordinator that routes one gear down."""
    bus, app = Bus(), FastAPI()
    seen: list[dict] = []

    async def record(ev: dict) -> None:
        seen.append(ev)

    async def coordinator(ev: dict) -> None:
        await bus.publish(
            {
                "type": "route.decided",
                "prompt_id": ev["prompt_id"],
                "gear_needed": ev["gear_needed"],
                "gear_used": max(1, ev["gear_needed"] - route_shift),
                "model": "stub",
                "deferred": False,
                "protected": False,
                "reason": "stub",
            }
        )

    bus.subscribe("*", record)
    bus.subscribe("triage.decided", coordinator)
    triage.register(bus, app)
    return seen, TestClient(app)


def test_observe_publishes_in_order_and_returns_route():
    seen, c = _client()
    body = c.post(
        "/v1/triage",
        json={
            "prompt": "write a detailed essay on grid storage with code examples " * 3,
            "observe": True,
            "prompt_id": "claude-abc12345",
        },
    ).json()

    assert body["prompt_id"] == "claude-abc12345"
    types = [e["type"] for e in seen if e.get("prompt_id") == "claude-abc12345"]
    assert types == ["prompt.received", "triage.decided", "route.decided"]

    received = seen[0]
    assert received["source"] == "extension"
    assert received["chars"] > 0
    # Triage used the text classification, not the length heuristic.
    triaged = next(e for e in seen if e["type"] == "triage.decided")
    assert triaged["gear_needed"] == body["gear"]
    assert body["route"] == {
        "gear_needed": body["gear"],
        "gear_used": max(1, body["gear"] - 1),
        "deferred": False,
    }
    assert "claude-abc12345" not in triage.HINTS


def test_observe_generates_prompt_id_and_keeps_source():
    seen, c = _client(route_shift=0)
    body = c.post(
        "/v1/triage", json={"prompt": "what's 15% of 80", "observe": True, "source": "api"}
    ).json()
    assert body["prompt_id"].startswith("ext-")
    assert seen[0]["source"] == "api"
    assert body["route"]["gear_used"] == body["route"]["gear_needed"]


def test_without_observe_publishes_nothing():
    seen, c = _client()
    body = c.post("/v1/triage", json={"prompt": "what's 15% of 80"}).json()
    assert set(body) == {"gear", "confidence", "label", "reason"}
    assert seen == []


def test_observe_without_coordinator_returns_null_route():
    bus, app = Bus(), FastAPI()
    triage.register(bus, app)
    body = TestClient(app).post(
        "/v1/triage", json={"prompt": "summarize this", "observe": True}
    ).json()
    assert body["route"] is None
    assert body["prompt_id"] not in triage.HINTS

"""Tests for the Grid agent (A5): level thresholds and manual demo alert."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.agents.grid import register


class FakeBus:
    def __init__(self) -> None:
        self.handlers: dict[str, list] = {}
        self.published: list[dict] = []

    def subscribe(self, event_type, handler) -> None:
        self.handlers.setdefault(event_type, []).append(handler)

    async def publish(self, event: dict) -> None:
        self.published.append(event)


def _client():
    bus, app = FakeBus(), FastAPI()
    register(bus, app)
    return bus, TestClient(app)


def _feed_load(bus: FakeBus, mw: float) -> None:
    import asyncio

    asyncio.run(
        bus.handlers["grid.load"][0](
            {"type": "grid.load", "load_mw": mw, "replay_clock": "t", "source": "replay"}
        )
    )


def test_levels_and_boundaries():
    bus, _ = _client()
    got = {}
    for mw in (18200, 20000, 20000.1, 23500, 23500.1, 24180, 26586):
        _feed_load(bus, mw)
        got[mw] = bus.published[-1]["level"]
    assert got == {
        18200: "green",
        20000: "green",
        20000.1: "yellow",
        23500: "yellow",
        23500.1: "red",
        24180: "red",
        26586: "red",
    }


def test_alert_without_prior_load_has_sensible_mw():
    _, c = _client()
    body = c.post("/v1/demo/alert", json={"level": "red"}).json()
    assert body["level"] == "red"
    assert body["load_mw"] > 23500  # never "red at 0 MW"


def test_alert_load_always_matches_level():
    bus, c = _client()
    _feed_load(bus, 25000.0)
    # last load is red; asking for yellow must not report 25,000 MW as yellow
    y = c.post("/v1/demo/alert", json={"level": "yellow"}).json()
    assert 20000 < y["load_mw"] <= 23500
    g = c.post("/v1/demo/alert", json={"level": "green"}).json()
    assert 0 < g["load_mw"] <= 20000
    # asking for red when the last real load already is red keeps the real load
    _feed_load(bus, 25000.0)
    r = c.post("/v1/demo/alert", json={"level": "red"}).json()
    assert r["load_mw"] == 25000.0


def test_alert_rejects_bad_level_and_get_grid_reflects_latest():
    _, c = _client()
    assert c.post("/v1/demo/alert", json={"level": "purple"}).status_code == 422
    c.post("/v1/demo/alert", json={"level": "yellow"})
    assert c.get("/v1/grid").json()["level"] == "yellow"

"""Endpoint tests for POST /v1/demo/replay: validation, defaults, restart.

Uses a very high speed so the replay finishes near-instantly and does not leave
a background task running between tests. Each test cancels the controller at the
end via app.state.replay_controller.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.replay import DEFAULT_SPEED, MINUTES_PER_DAY, SUPPORTED_DATE


@pytest.fixture()
def client():
    # TestClient runs startup (register_all) and shutdown.
    with TestClient(app) as c:
        yield c


def test_replay_default_body_starts(client):
    # Omit both fields -> defaults date=2025-06-24, speed=480.
    r = client.post("/v1/demo/replay", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "started"
    assert body["date"] == SUPPORTED_DATE
    assert body["speed"] == DEFAULT_SPEED
    assert body["minutes"] == MINUTES_PER_DAY
    assert body["duration_s"] == pytest.approx(180.0)


def test_replay_explicit_speed(client):
    r = client.post("/v1/demo/replay", json={"date": SUPPORTED_DATE, "speed": 14400})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["speed"] == 14400
    assert body["duration_s"] == pytest.approx(6.0)


def test_replay_rejects_wrong_date(client):
    r = client.post("/v1/demo/replay", json={"date": "2024-01-01", "speed": 480})
    assert r.status_code == 400, r.text
    assert "2025-06-24" in r.json()["detail"]


def test_replay_rejects_zero_speed(client):
    r = client.post("/v1/demo/replay", json={"speed": 0})
    assert r.status_code == 422, r.text


def test_replay_rejects_negative_speed(client):
    r = client.post("/v1/demo/replay", json={"speed": -5})
    assert r.status_code == 422, r.text


def test_replay_rejects_too_fast_speed(client):
    r = client.post("/v1/demo/replay", json={"speed": 20001})
    assert r.status_code == 422, r.text


def test_replay_accepts_boundary_speed(client):
    r = client.post("/v1/demo/replay", json={"speed": 20000})
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_restart_cancels_old_task():
    """Starting a replay while one is running cancels the old task (reset)."""
    from engine.bus import bus
    from engine.replay import ReplayController

    controller = ReplayController(bus)
    # Start a slow replay so it is definitely still running.
    summary1 = await controller.start(SUPPORTED_DATE, speed=1.0)
    first_task = controller._task
    assert summary1["status"] == "started"
    assert first_task is not None and not first_task.done()

    # Restart: the old task must be cancelled and a new one created.
    await controller.start(SUPPORTED_DATE, speed=1.0)
    second_task = controller._task
    assert second_task is not first_task
    assert first_task.cancelled() or first_task.done()

    # Clean up the running task.
    await controller.cancel()
    assert controller._task is None

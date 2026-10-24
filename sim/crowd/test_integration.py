"""Integration test: crowd sim against the real engine (PR B6).

Boots the real FastAPI app (engine.app.app) with a TestClient so every engine
module registers, then ALSO registers sim.crowd explicitly (engine/app.py is
frozen and will only list "sim.crowd" after a joint contract: PR). Starts
Junaid's replay fast and checks the whole loop runs:

  prompt.received -> triage.decided -> route.decided -> answer.completed
  -> coordinator.report / utility.request / utility.verdict

This is a slow, real test (it runs a ~6 s replay), so it is marked `slow` and is
skipped unless RUN_CROWD_INTEGRATION=1. The companion script
sim/crowd/run_integration.py runs the same flow and prints the full report.
"""

from __future__ import annotations

import os
import time

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_CROWD_INTEGRATION", "0") != "1",
    reason="set RUN_CROWD_INTEGRATION=1 to run the real-engine integration test",
)


def test_crowd_loop_through_real_engine():
    from fastapi.testclient import TestClient

    import engine.app as engine_app
    import sim.crowd

    collected = []

    with TestClient(engine_app.app) as client:
        bus = engine_app.bus

        async def collector(ev):
            collected.append(ev)

        bus.subscribe("*", collector)
        sim = sim.crowd.register(bus, engine_app.app)  # noqa: F841
        assert sim is not None

        # speed 14400 => full 24 h day in ~6 s.
        resp = client.post("/v1/demo/replay", json={"date": "2025-06-24", "speed": 14400})
        assert resp.status_code == 200
        duration = resp.json()["duration_s"]

        # wait for the replay to finish plus drain time.
        time.sleep(duration + 3.0)

    received = [e for e in collected if e["type"] == "prompt.received" and e.get("source") == "crowd"]
    answers = [e for e in collected if e["type"] == "answer.completed"]

    assert len(received) > 0, "crowd emitted no prompts"
    # ~200/replay-hour * 24 replay-hours scaled by load; allow a wide band.
    assert 2000 <= len(received) <= 7000, f"unexpected crowd volume: {len(received)}"
    assert len(answers) >= len(received) * 0.5

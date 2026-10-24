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

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_CROWD_INTEGRATION", "0") != "1",
    reason="set RUN_CROWD_INTEGRATION=1 to run the real-engine integration test",
)


def test_crowd_loop_through_real_engine():
    from sim.crowd.run_integration import run

    report = run(speed=14400.0)

    assert report["crowd_prompts"] > 0, "crowd emitted no prompts"
    # ~200/replay-hour on average; allow a wide band for Poisson + saturation.
    assert 120 <= report["prompts_per_replay_hour"] <= 260
    # every crowd prompt must be triaged and routed by Aru's agents.
    assert report["every_prompt_triaged"] is True
    assert report["every_prompt_routed"] is True
    # loop closes: answers ~= routed.
    assert report["answered"] >= report["routed"] * 0.95
    # all energy is estimated (no live meter / tunnel) or a mix if a meter is up.
    assert set(report["energy_source_mix"]).issubset({"estimated", "measured"})
    # roughly 1 in 10 attempted real generation.
    ratio = report["real_attempts"] / max(1, report["crowd_prompts"])
    assert 0.05 <= ratio <= 0.15

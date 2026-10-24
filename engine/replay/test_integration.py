"""Integration test: a fast full-day replay drives Aru's Grid agent and
Junaid's Utility agent through the real engine app and bus.

We subscribe a collector to '*' on the shared bus (bus.history only keeps the
last 50 events, so a collector is required), start a speed=14400 replay (the
whole day in ~6 real seconds), wait for it to finish, then assert:

  * grid.state levels progress green -> yellow -> red -> ... -> green
  * the Utility agent emits exactly one utility.request (sustained red)

Run with: pytest engine/replay/test_integration.py -s  (to see the printed seq)
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from engine.app import app
from engine.bus import bus
from engine.replay import MINUTES_PER_DAY


def test_full_replay_drives_grid_and_utility(capsys):
    collected: list[dict] = []

    async def collector(event: dict) -> None:
        collected.append(dict(event))

    bus.subscribe("*", collector)

    with TestClient(app) as client:
        # Whole day in ~6 real seconds.
        r = client.post("/v1/demo/replay", json={"date": "2025-06-24", "speed": 14400})
        assert r.status_code == 200, r.text
        duration = r.json()["duration_s"]

        # Wait for the replay to finish (plus margin for agent fan-out).
        deadline = time.time() + duration + 10.0
        while time.time() < deadline:
            loads = [e for e in collected if e["type"] == "grid.load"]
            if len(loads) >= MINUTES_PER_DAY:
                break
            time.sleep(0.1)

    loads = [e for e in collected if e["type"] == "grid.load"]
    states = [e for e in collected if e["type"] == "grid.state"]
    requests = [e for e in collected if e["type"] == "utility.request"]

    # All 1440 minutes replayed, one grid.state per grid.load.
    assert len(loads) == MINUTES_PER_DAY, f"got {len(loads)} grid.load events"
    assert len(states) == MINUTES_PER_DAY, f"got {len(states)} grid.state events"

    # Build the level transition sequence.
    transitions: list[tuple[str, float, str]] = []
    prev = None
    for s in states:
        if s["level"] != prev:
            transitions.append((s["replay_clock"], round(s["load_mw"], 1), s["level"]))
            prev = s["level"]

    levels_only = [t[2] for t in transitions]

    # Print the sequence as proof.
    print("\nLevel transitions (clock, load_mw, level):")
    for t in transitions:
        print(f"  {t[0]}  {t[1]:>9.1f} MW  {t[2]}")
    peak = max(states, key=lambda e: e["load_mw"])
    print(f"Peak grid.state: {peak['load_mw']:.1f} MW at {peak['replay_clock']}")
    print(f"utility.request count: {len(requests)}")

    # green -> yellow -> red appears, and the day ends back at green.
    assert levels_only[0] == "green"
    assert "yellow" in levels_only
    assert "red" in levels_only
    assert levels_only[-1] == "green"
    # Order: first red comes after first yellow, which comes after green.
    assert levels_only.index("yellow") < levels_only.index("red")

    # Peak matches the real EIA peak.
    assert peak["load_mw"] >= 25898.0 - 1.0

    # Utility agent fires exactly once for the sustained red.
    assert len(requests) == 1, f"expected 1 utility.request, got {len(requests)}"
    req = requests[0]
    assert req["cut_pct"] == 25.0
    assert req["duration_min"] == 120

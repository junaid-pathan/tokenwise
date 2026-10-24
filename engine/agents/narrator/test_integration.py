"""Integration check: real bus + app, grid.load red x2 drives the loop.

Publishes grid.load (red) twice so A's Grid agent -> grid.state (red x2),
Junaid's Utility agent -> utility.request, A's Coordinator -> coordinator.commit.
Collects narrator.line events via bus.subscribe('*') (bus.history keeps only 50)
and asserts every number in each line appears in its cited events.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from engine.agents.narrator import guard


@pytest.mark.asyncio
async def test_real_loop_narrator_lines(monkeypatch):
    # Deterministic: no real Bedrock in the integration loop.
    monkeypatch.setenv("NARRATOR_USE_LLM", "0")

    # Import inside the test so env is set first and the app is fresh.
    from engine.app import app
    from engine.bus import bus

    collected: list[dict] = []

    async def collector(event: dict) -> None:
        if event.get("type") == "narrator.line":
            collected.append(event)

    bus.subscribe("*", collector)

    # Map every emitted event id -> event, to verify refs resolve to real events.
    by_id: dict[str, dict] = {}

    async def indexer(event: dict) -> None:
        if "id" in event:
            by_id[event["id"]] = event

    bus.subscribe("*", indexer)

    # TestClient runs the app's startup, registering all agents incl. narrator.
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"] is True

        narrator = app.state.narrator_agent
        # Stop the background drainer (it may live on a different loop under
        # TestClient) and drive drain_once() from THIS loop deterministically.
        await narrator.stop()

        # Drive the loop: two red loads so Grid -> red x2, Utility requests,
        # Coordinator commits.
        await bus.publish({
            "type": "grid.load", "load_mw": 24180.0,
            "replay_clock": "2025-06-24T16:00:00", "source": "replay",
        })
        await bus.publish({
            "type": "grid.load", "load_mw": 24180.0,
            "replay_clock": "2025-06-24T16:05:00", "source": "replay",
        })

        # Drain all pending facts (grid level change, request, commit), one per
        # call, exercising the real rate-limit/priority logic.
        for _ in range(6):
            if await narrator.drain_once() is None:
                break

    # We expect at least one narrator.line (grid level change, and/or request,
    # and/or commit depending on coalescing/priority).
    assert collected, "narrator produced no lines"

    # Every number in every line must appear in the cited events.
    for line in collected:
        cited = [by_id[r] for r in line["refs"] if r in by_id]
        assert cited, f"refs did not resolve to events: {line}"
        assert guard.numbers_supported(line["text"], cited), (
            f"unsupported number in line: {line['text']} refs={line['refs']}"
        )
        assert guard.word_count(line["text"]) <= guard.MAX_WORDS

    # Print the produced lines for the proof (visible with -s).
    for line in collected:
        print("LINE:", line["text"], "REFS:", line["refs"])

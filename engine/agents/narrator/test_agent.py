"""Tests for the NarratorAgent: rate limit, coalescing, LLM guard, refs."""

from __future__ import annotations

import asyncio

import pytest

from engine.agents.narrator import NarratorAgent, llm_line


class FakeBus:
    """Minimal bus: records published events; never blocks."""

    def __init__(self):
        self.events = []

    async def publish(self, event: dict):
        self.events.append(event)

    def subscribe(self, etype, handler):
        pass


def _grid_state(level, load_mw, eid):
    return {"type": "grid.state", "id": eid, "ts": 1, "load_mw": load_mw, "level": level}


def _verdict(eid, accepted=True, shortfall=0.7):
    return {
        "type": "utility.verdict",
        "id": eid,
        "ts": 1,
        "request_id": "r-001",
        "accepted": accepted,
        "shortfall_pct": shortfall,
    }


def _request(eid):
    return {"type": "utility.request", "id": eid, "ts": 1, "cut_pct": 25.0, "duration_min": 120}


@pytest.fixture(autouse=True)
def _disable_llm(monkeypatch):
    """Default: LLM off so tests are deterministic unless they opt in."""
    monkeypatch.setenv("NARRATOR_USE_LLM", "0")


@pytest.mark.asyncio
async def test_level_change_only():
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)
    await agent.on_event(_grid_state("red", 24180.0, "g1"))
    await agent.on_event(_grid_state("red", 24200.0, "g2"))  # same level -> skip
    await agent.on_event(_grid_state("yellow", 22000.0, "g3"))  # change -> keep
    # Two distinct facts pending under one kind key (latest wins = g3 yellow).
    ev = await agent.drain_once()
    assert ev is not None
    assert "yellow" in ev["text"]
    assert ev["refs"] == ["g3"]


@pytest.mark.asyncio
async def test_coalesce_latest_level():
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)
    # Burst of grid levels; only the newest should survive coalescing.
    await agent.on_event(_grid_state("red", 24180.0, "g1"))
    await agent.on_event(_grid_state("yellow", 22000.0, "g2"))
    await agent.on_event(_grid_state("green", 18000.0, "g3"))
    ev = await agent.drain_once()
    assert ev["refs"] == ["g3"]
    # Only one line for the whole burst.
    assert await agent.drain_once() is None


@pytest.mark.asyncio
async def test_priority_verdict_outranks_level():
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)
    await agent.on_event(_grid_state("red", 24180.0, "g1"))
    await agent.on_event(_verdict("v1"))
    # Verdict (priority 40) wins over grid level (10).
    first = await agent.drain_once()
    assert first["refs"] == ["v1"]
    # Then the level is still narrated on the next drain.
    second = await agent.drain_once()
    assert second["refs"] == ["g1"]


@pytest.mark.asyncio
async def test_rate_limit_one_per_interval():
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.05)
    agent.start()
    try:
        # Flood with distinct kinds.
        await agent.on_event(_grid_state("red", 24180.0, "g1"))
        await agent.on_event(_request("u1"))
        await agent.on_event(_verdict("v1"))
        # Within less than one interval, nothing published yet.
        await asyncio.sleep(0.02)
        assert len(bus.events) == 0
        # After one interval, exactly one line.
        await asyncio.sleep(0.05)
        assert len(bus.events) == 1
        # After another interval, a second line (not all three at once).
        await asyncio.sleep(0.06)
        assert len(bus.events) == 2
    finally:
        await agent.stop()


@pytest.mark.asyncio
async def test_refs_hold_right_ids():
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["refs"] == ["u1"]
    assert "25 percent" in ev["text"]


@pytest.mark.asyncio
async def test_on_event_never_blocks_bus():
    """Handler must return promptly and never publish inline."""
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=10.0)  # long interval
    await agent.on_event(_verdict("v1"))
    # No line published synchronously by the handler.
    assert bus.events == []


# --- LLM path (Done-when) ---------------------------------------------------

@pytest.mark.asyncio
async def test_fake_llm_wrong_number_falls_back_to_template(monkeypatch):
    """DONE-WHEN: a bad number in an LLM line is caught and replaced by a template."""
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def fake_converse(model_id, prompt, system=None, max_tokens=60, temperature=0):
        # Cited event says 25 percent; the LLM hallucinates 30.
        return {"text": "Utility asked for a 30 percent cut.", "model": "x",
                "latency_ms": 1, "output_tokens": 5}

    agent.converse = fake_converse
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    # The bad "30 percent" line was rejected; the template is used instead.
    assert ev["text"] == "Utility asked for a 25 percent cut for 120 minutes."
    assert ev["refs"] == ["u1"]


@pytest.mark.asyncio
async def test_fake_llm_good_number_is_used(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def fake_converse(model_id, prompt, system=None, max_tokens=60, temperature=0):
        return {"text": "Utility requested a 25 percent reduction.", "model": "x",
                "latency_ms": 1, "output_tokens": 5}

    agent.converse = fake_converse
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["text"] == "Utility requested a 25 percent reduction."


@pytest.mark.asyncio
async def test_fake_llm_exception_falls_back(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def boom(model_id, prompt, system=None, max_tokens=60, temperature=0):
        raise RuntimeError("no credentials")

    agent.converse = boom
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["text"] == "Utility asked for a 25 percent cut for 120 minutes."


@pytest.mark.asyncio
async def test_fake_llm_timeout_falls_back(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def slow(model_id, prompt, system=None, max_tokens=60, temperature=0):
        import time
        time.sleep(0.3)
        return {"text": "ok", "model": "x", "latency_ms": 1, "output_tokens": 1}

    # Shrink the timeout so the test is fast.
    monkeypatch.setattr(llm_line, "LLM_TIMEOUT_S", 0.05)
    agent.converse = slow
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["text"] == "Utility asked for a 25 percent cut for 120 minutes."


@pytest.mark.asyncio
async def test_fake_llm_empty_falls_back(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def empty(model_id, prompt, system=None, max_tokens=60, temperature=0):
        return {"text": "   ", "model": "x", "latency_ms": 1, "output_tokens": 0}

    agent.converse = empty
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["text"] == "Utility asked for a 25 percent cut for 120 minutes."


@pytest.mark.asyncio
async def test_fake_llm_too_long_falls_back(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    def verbose(model_id, prompt, system=None, max_tokens=60, temperature=0):
        # 20 words, no bad numbers, but over the 18-word limit.
        return {"text": " ".join(["the"] * 20), "model": "x",
                "latency_ms": 1, "output_tokens": 20}

    agent.converse = verbose
    await agent.on_event(_request("u1"))
    ev = await agent.drain_once()
    assert ev["text"] == "Utility asked for a 25 percent cut for 120 minutes."


@pytest.mark.asyncio
async def test_llm_budget_cap(monkeypatch):
    monkeypatch.setenv("NARRATOR_USE_LLM", "1")
    monkeypatch.setenv("NARRATOR_MAX_LLM_CALLS", "1")
    bus = FakeBus()
    agent = NarratorAgent(bus, interval_s=0.01)

    calls = {"n": 0}

    def fake_converse(model_id, prompt, system=None, max_tokens=60, temperature=0):
        calls["n"] += 1
        return {"text": "Utility requested a 25 percent reduction.", "model": "x",
                "latency_ms": 1, "output_tokens": 5}

    agent.converse = fake_converse
    await agent.on_event(_request("u1"))
    await agent.drain_once()
    await agent.on_event(_request("u2"))
    await agent.drain_once()
    # Only one real LLM call allowed; the second used the template.
    assert calls["n"] == 1

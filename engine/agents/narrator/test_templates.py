"""Tests for the deterministic template lines and fact extraction."""

from __future__ import annotations

from engine.agents.narrator import templates


def _grid_state(level="red", load_mw=24180.0, eid="g1"):
    return {
        "type": "grid.state",
        "id": eid,
        "ts": 1,
        "load_mw": load_mw,
        "level": level,
        "replay_clock": "2025-06-24T16:00:00",
        "source": "replay",
    }


def test_grid_state_template_red():
    ev = _grid_state()
    fact = templates.fact_from_event(ev)
    assert fact is not None
    assert fact["text"] == "Grid is red at 24,180 megawatts."
    assert fact["refs"] == ["g1"]
    assert fact["kind"] == "grid.state"


def test_grid_state_template_green_and_yellow():
    assert (
        templates.fact_from_event(_grid_state(level="green", load_mw=18200.0))["text"]
        == "Grid is green at 18,200 megawatts."
    )
    assert (
        templates.fact_from_event(_grid_state(level="yellow", load_mw=22000.0))["text"]
        == "Grid is yellow at 22,000 megawatts."
    )


def test_grid_state_level_change_only():
    ev = _grid_state(level="red")
    # Same level as previous -> skipped.
    assert templates.fact_from_event(ev, prev_level="red") is None
    # Different level -> narrated.
    assert templates.fact_from_event(ev, prev_level="yellow") is not None
    # No previous level -> narrated.
    assert templates.fact_from_event(ev, prev_level=None) is not None


def test_utility_request_template():
    ev = {
        "type": "utility.request",
        "id": "u1",
        "ts": 2,
        "request_id": "r-001",
        "cut_pct": 25.0,
        "duration_min": 120,
        "reason": "grid red for 2 samples",
    }
    fact = templates.fact_from_event(ev)
    assert fact["text"] == "Utility asked for a 25 percent cut for 120 minutes."
    assert fact["refs"] == ["u1"]


def test_coordinator_commit_template():
    ev = {
        "type": "coordinator.commit",
        "id": "c1",
        "ts": 3,
        "request_id": "r-001",
        "committed_cut_pct": 25.0,
        "policy": {"gear_offset": -1, "defer_batch": True, "protect_critical": True},
    }
    fact = templates.fact_from_event(ev)
    assert (
        fact["text"]
        == "Coordinator committed to 25 percent, shifting prompts down a gear."
    )


def test_coordinator_report_template():
    ev = {
        "type": "coordinator.report",
        "id": "rep1",
        "ts": 4,
        "request_id": "r-001",
        "achieved_cut_pct": 24.3,
        "joules_baseline": 1000.0,
        "joules_actual": 757.0,
    }
    fact = templates.fact_from_event(ev)
    assert fact["text"] == "So far we have delivered 24.3 percent."


def test_utility_verdict_accepted_and_rejected():
    accepted = {
        "type": "utility.verdict",
        "id": "v1",
        "ts": 5,
        "request_id": "r-001",
        "accepted": True,
        "shortfall_pct": 0.7,
    }
    fact = templates.fact_from_event(accepted)
    assert "accepted" in fact["text"].lower()

    rejected = {
        "type": "utility.verdict",
        "id": "v2",
        "ts": 6,
        "request_id": "r-001",
        "accepted": False,
        "shortfall_pct": 5.0,
    }
    fact = templates.fact_from_event(rejected)
    assert "5 points" in fact["text"]


def test_unhandled_event_returns_none():
    assert templates.fact_from_event({"type": "power.sample", "id": "p", "watts": 55.0}) is None


def test_templates_never_mention_model_or_tokens():
    evs = [
        _grid_state(),
        {"type": "utility.request", "id": "u", "cut_pct": 25.0, "duration_min": 120},
        {"type": "coordinator.commit", "id": "c", "committed_cut_pct": 25.0},
        {"type": "coordinator.report", "id": "r", "achieved_cut_pct": 24.3},
        {"type": "utility.verdict", "id": "v", "accepted": True, "shortfall_pct": 0.7},
    ]
    for ev in evs:
        fact = templates.fact_from_event(ev)
        assert fact is not None
        low = fact["text"].lower()
        assert "model" not in low
        assert "token" not in low

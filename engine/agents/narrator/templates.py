"""Deterministic plain-language template lines for the Narrator.

Every template is built ONLY from fields on the event(s) it describes, so the
number guard (guard.py) can always verify it. Templates never mention the words
"model" or "tokens" and never invent facts. When an LLM line fails the guard,
the Narrator falls back to the matching template here.

A "fact" is a small dict describing one narratable event:
    {
        "kind": str,           # e.g. "grid.state", "utility.request"
        "refs": list[str],     # ids of the events this line cites
        "text": str,           # the deterministic template line
        "priority": int,       # higher = more important to narrate
        "events": list[dict],  # the cited event dicts (for the number guard)
    }
"""

from __future__ import annotations

from typing import Optional

# Higher priority facts win when events arrive faster than the rate limit.
# A verdict or a commit outranks a repeated grid level.
PRIORITY = {
    "utility.verdict": 40,
    "coordinator.report": 35,
    "coordinator.commit": 30,
    "utility.request": 20,
    "grid.state": 10,
}


def _fmt_mw(load_mw: float) -> str:
    """24180.0 -> '24,180' (thousands commas, no decimals for whole MW)."""
    return f"{round(float(load_mw)):,}"


def _fmt_pct(value: float) -> str:
    """25.0 -> '25', 24.3 -> '24.3' (drop a trailing .0, keep real decimals)."""
    f = float(value)
    if f == int(f):
        return str(int(f))
    return f"{f:g}"


def fact_from_event(
    event: dict, prev_level: Optional[str] = None
) -> Optional[dict]:
    """Turn one event into a narratable fact, or None if it should be skipped.

    grid.state is only narrated on a LEVEL CHANGE (prev_level differs). All
    other handled types always produce a fact.
    """
    etype = event.get("type")
    eid = event.get("id", "")

    if etype == "grid.state":
        level = event.get("level")
        if prev_level is not None and level == prev_level:
            return None  # no level change -> do not narrate
        return {
            "kind": etype,
            "refs": [eid],
            "text": _grid_state_line(event),
            "priority": PRIORITY[etype],
            "events": [event],
        }

    if etype == "utility.request":
        return {
            "kind": etype,
            "refs": [eid],
            "text": _utility_request_line(event),
            "priority": PRIORITY[etype],
            "events": [event],
        }

    if etype == "coordinator.commit":
        return {
            "kind": etype,
            "refs": [eid],
            "text": _coordinator_commit_line(event),
            "priority": PRIORITY[etype],
            "events": [event],
        }

    if etype == "coordinator.report":
        return {
            "kind": etype,
            "refs": [eid],
            "text": _coordinator_report_line(event),
            "priority": PRIORITY[etype],
            "events": [event],
        }

    if etype == "utility.verdict":
        return {
            "kind": etype,
            "refs": [eid],
            "text": _utility_verdict_line(event),
            "priority": PRIORITY[etype],
            "events": [event],
        }

    return None


# --- per-type template lines ------------------------------------------------

def _grid_state_line(event: dict) -> str:
    level = str(event.get("level", "")).lower()
    mw = _fmt_mw(event.get("load_mw", 0))
    if level == "red":
        return f"Grid is red at {mw} megawatts."
    if level == "yellow":
        return f"Grid is yellow at {mw} megawatts."
    return f"Grid is green at {mw} megawatts."


def _utility_request_line(event: dict) -> str:
    cut = _fmt_pct(event.get("cut_pct", 0))
    mins = _fmt_pct(event.get("duration_min", 0))
    return f"Utility asked for a {cut} percent cut for {mins} minutes."


def _coordinator_commit_line(event: dict) -> str:
    cut = _fmt_pct(event.get("committed_cut_pct", 0))
    return (
        f"Coordinator committed to {cut} percent, "
        "shifting prompts down a gear."
    )


def _coordinator_report_line(event: dict) -> str:
    achieved = _fmt_pct(event.get("achieved_cut_pct", 0))
    return f"So far we have delivered {achieved} percent."


def _utility_verdict_line(event: dict) -> str:
    accepted = bool(event.get("accepted", False))
    shortfall = float(event.get("shortfall_pct", 0.0))
    if accepted:
        if shortfall and shortfall > 0:
            return f"Delivered within target. Utility accepted."
        return "Utility accepted the cut."
    # Rejected: cite the shortfall (a number present on the event).
    pts = _fmt_pct(shortfall)
    return f"Shortfall of {pts} points. Utility asked for more."

"""A (PR A6/A7): Coordinator. Deterministic policy + negotiation.

Listens: triage.decided, grid.state, utility.request, answer.completed.
Emits:   route.decided, coordinator.commit, coordinator.report.

A6 policy:
  * On triage.decided, pick gear_used from gear_needed and the current grid level.
  * When the grid is red and confidence >= 0.6, shift ONE gear down (floor Gear 1).
  * Never shift a protected prompt.
  * Emit route.decided with the chosen gear + the gear's model from gears.json.

A7 negotiation:
  * On utility.request, set a target cut, emit coordinator.commit with a policy
    (gear_offset -1, defer batch, protect critical).
  * Track joules from answer.completed (baseline = what Gear `gear_needed` would
    have cost; actual = what `gear_used` actually cost) and emit coordinator.report
    every REPORT_EVERY answers while a request is active.
"""

from __future__ import annotations

import json
from pathlib import Path

_GEARS_PATH = Path(__file__).resolve().parents[3] / "contracts" / "gears.json"

# Confidence floor for shifting down under a red grid.
_SHIFT_CONF = 0.6
# Emit a coordinator.report after this many answers while a request is active.
REPORT_EVERY = 5


def _load_gear_models() -> dict[int, str]:
    data = json.loads(_GEARS_PATH.read_text(encoding="utf-8"))
    out: dict[int, str] = {}
    for g in data["gears"]:
        out[int(g["gear"])] = g.get("ollama_model") or g.get("bedrock_model") or f"gear-{g['gear']}"
    return out


def register(bus, app):
    gear_models = _load_gear_models()

    st = {
        "level": "green",            # latest grid.state level
        "active_request": None,      # request_id currently being served, or None
        "committed_cut_pct": 0.0,
        "joules_baseline": 0.0,      # sum over answered prompts
        "joules_actual": 0.0,
        "answers_since_report": 0,
        # remember each prompt's needed/used gear so answer.completed can be scored
        "gear_needed": {},           # prompt_id -> gear_needed
        "protected": {},             # prompt_id -> bool
    }

    def model_for(gear: int) -> str:
        return gear_models.get(gear, f"gear-{gear}")

    def choose_gear(gear_needed: int, confidence: float, protected: bool) -> tuple[int, str]:
        """Return (gear_used, reason) applying the red-grid downshift policy."""
        if protected:
            return gear_needed, "protected, gear kept"
        if st["level"] == "red" and confidence >= _SHIFT_CONF and gear_needed > 1:
            return gear_needed - 1, "red grid, shifted one gear down"
        if st["level"] == "red":
            return gear_needed, "red grid, gear kept (low confidence or floor)"
        return gear_needed, f"{st['level']} grid, triage gear kept"

    # --- A6: routing --------------------------------------------------------
    async def on_triage(ev: dict) -> None:
        pid = ev.get("prompt_id")
        gear_needed = int(ev.get("gear_needed", 1))
        confidence = float(ev.get("confidence", 0.0))
        protected = bool(ev.get("protected", False))

        gear_used, reason = choose_gear(gear_needed, confidence, protected)
        st["gear_needed"][pid] = gear_needed
        st["protected"][pid] = protected

        await bus.publish({
            "type": "route.decided",
            "prompt_id": pid,
            "gear_needed": gear_needed,
            "gear_used": gear_used,
            "model": model_for(gear_used),
            "deferred": st["active_request"] is not None and not protected,
            "protected": protected,
            "reason": reason,
        })

    async def on_grid_state(ev: dict) -> None:
        st["level"] = ev.get("level", st["level"])

    # --- A7: negotiation ----------------------------------------------------
    async def on_utility_request(ev: dict) -> None:
        req_id = ev.get("request_id")
        cut = float(ev.get("cut_pct", 0.0))
        st["active_request"] = req_id
        st["committed_cut_pct"] = cut
        # reset accounting for this request
        st["joules_baseline"] = 0.0
        st["joules_actual"] = 0.0
        st["answers_since_report"] = 0

        await bus.publish({
            "type": "coordinator.commit",
            "request_id": req_id,
            "committed_cut_pct": cut,
            "policy": {
                "gear_offset": -1,
                "defer_batch": True,
                "protect_critical": True,
            },
        })

    async def on_answer_completed(ev: dict) -> None:
        if st["active_request"] is None:
            return
        pid = ev.get("prompt_id")
        gear_used = int(ev.get("gear_used", 1))
        actual_j = float(ev.get("energy_j", 0.0))

        # baseline = energy the originally-needed gear would have used.
        gear_needed = int(st["gear_needed"].get(pid, gear_used))
        # scale actual by the per-gear ratio as a simple deterministic estimate:
        # higher gears cost more; if we shifted down, baseline > actual.
        if gear_used > 0:
            baseline_j = actual_j * (gear_needed / gear_used)
        else:
            baseline_j = actual_j

        st["joules_actual"] += actual_j
        st["joules_baseline"] += baseline_j
        st["answers_since_report"] += 1

        if st["answers_since_report"] >= REPORT_EVERY:
            await _emit_report()

    async def _emit_report() -> None:
        base = st["joules_baseline"]
        actual = st["joules_actual"]
        achieved = ((base - actual) / base * 100.0) if base > 0 else 0.0
        st["answers_since_report"] = 0
        await bus.publish({
            "type": "coordinator.report",
            "request_id": st["active_request"],
            "achieved_cut_pct": round(achieved, 1),
            "joules_baseline": round(base, 1),
            "joules_actual": round(actual, 1),
        })

    bus.subscribe("triage.decided", on_triage)
    bus.subscribe("grid.state", on_grid_state)
    bus.subscribe("utility.request", on_utility_request)
    bus.subscribe("answer.completed", on_answer_completed)

    return None

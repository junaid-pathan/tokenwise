"""A (PR A10): scorecard. Compares No-Downshift (baseline) vs Downshift (actual)
over answered prompts and emits scorecard.update.

Each answer contributes to two sides:
  * downshift (actual)    : the gear the Coordinator actually ran (gear_used),
                            with the measured energy + latency from answer.completed.
  * no_downshift (baseline): the gear triage said was needed (gear_needed), i.e.
                            what we would have spent with no grid-aware downshift.

answer.completed only carries gear_used, so we learn gear_needed from the matching
route.decided (keyed by prompt_id). Baseline energy/latency are scaled from the
actual by a per-gear cost ratio when the two gears differ; when they are equal
(no downshift happened) both sides see the same numbers.

Quality match is a placeholder here (real eval is A12); it defaults to 100 for the
baseline and a configured kept-quality number for the downshift side.
"""

from __future__ import annotations

import statistics

# Rough relative compute cost per gear (bigger model = more joules/latency).
# Used only to derive the baseline side when a prompt was downshifted.
_GEAR_COST = {1: 1.0, 2: 2.0, 3: 4.0, 4: 9.0, 5: 20.0}

# Placeholder kept-quality for the downshift side until A12 measures it.
_DOWNSHIFT_QUALITY_PCT = 94.0


def _p50(values: list[float]) -> float:
    return float(statistics.median(values)) if values else 0.0


def register(bus, app):
    needed_gear: dict[str, int] = {}  # prompt_id -> gear_needed (from route.decided)

    # accumulators
    base_j: list[float] = []
    base_ms: list[float] = []
    down_j: list[float] = []
    down_ms: list[float] = []

    async def on_route(ev: dict) -> None:
        needed_gear[ev["prompt_id"]] = int(ev.get("gear_needed", ev.get("gear_used", 1)))

    async def on_answer(ev: dict) -> None:
        pid = ev.get("prompt_id")
        gear_used = int(ev.get("gear_used", 1))
        gear_needed = int(needed_gear.get(pid, gear_used))
        actual_j = float(ev.get("energy_j", 0.0))
        actual_ms = float(ev.get("latency_ms", 0))

        # downshift (actual)
        down_j.append(actual_j)
        down_ms.append(actual_ms)

        # no_downshift (baseline): scale actual to the needed gear's cost
        used_cost = _GEAR_COST.get(gear_used, float(gear_used))
        need_cost = _GEAR_COST.get(gear_needed, float(gear_needed))
        ratio = (need_cost / used_cost) if used_cost else 1.0
        base_j.append(actual_j * ratio)
        base_ms.append(actual_ms * ratio)

        await bus.publish({
            "type": "scorecard.update",
            "no_downshift": {
                "j_per_answer": round(sum(base_j) / len(base_j), 2),
                "quality_match_pct": 100.0,
                "p50_latency_ms": round(_p50(base_ms), 1),
            },
            "downshift": {
                "j_per_answer": round(sum(down_j) / len(down_j), 2),
                "quality_match_pct": _DOWNSHIFT_QUALITY_PCT,
                "p50_latency_ms": round(_p50(down_ms), 1),
            },
        })

    bus.subscribe("route.decided", on_route)
    bus.subscribe("answer.completed", on_answer)

    return None

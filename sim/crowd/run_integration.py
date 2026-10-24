"""Real-engine integration run for the crowd sim (PR B6, owner B).

Boots the real engine (engine.app.app) with a FastAPI TestClient so every module
registers, registers sim.crowd explicitly (engine/app.py is frozen; the human
adds the one-line MODULES entry via a joint contract: PR), runs Junaid's replay
fast, and reports the measured loop numbers the PRD asks for:

  * prompt.received per replay hour (target ~200 on average)
  * that each prompt got triage.decided / route.decided / answer.completed
  * the gear mix
  * fraction downshifted while the grid was red vs not
  * real generations vs estimates (tunnel may be down -> all fall back)
  * the coordinator.report / utility.request / utility.verdict events

Run (from the worktree root, shared venv):
    $py = "C:\\Users\\user\\Documents\\sip\\.venv\\Scripts\\python.exe"
    & $py -m sim.crowd.run_integration            # default speed 14400 (~6 s)
"""

from __future__ import annotations

import sys
import time
from collections import Counter


def run(speed: float = 14400.0) -> dict:
    from fastapi.testclient import TestClient

    import engine.app as engine_app
    import sim.crowd as crowd

    collected: list[dict] = []
    # track grid level timeline so we can attribute downshifts to red vs not.
    level_now = {"level": "green"}

    with TestClient(engine_app.app) as client:
        bus = engine_app.bus

        async def collector(ev):
            if ev.get("type") == "grid.state":
                level_now["level"] = ev.get("level", level_now["level"])
            # stamp the grid level seen at route time onto route events
            if ev.get("type") == "route.decided":
                ev = dict(ev)
                ev["_grid_level"] = level_now["level"]
            collected.append(ev)

        bus.subscribe("*", collector)
        sim = crowd.register(bus, engine_app.app)
        if sim is None:
            raise SystemExit("crowd disabled (CROWD_SIM=0 or no held-out prompts)")

        resp = client.post("/v1/demo/replay", json={"date": "2025-06-24", "speed": speed})
        resp.raise_for_status()
        duration = resp.json()["duration_s"]
        print(f"[run] replay started speed={speed} duration~{duration:.1f}s")
        time.sleep(duration + 3.0)

        stats = dict(sim.stats)

    return _report(collected, stats, speed)


def _report(collected: list[dict], stats: dict, speed: float) -> dict:
    def of(t):
        return [e for e in collected if e.get("type") == t]

    crowd_received = [e for e in of("prompt.received") if e.get("source") == "crowd"]
    triage = of("triage.decided")
    routes = of("route.decided")
    answers = of("answer.completed")

    crowd_ids = {e["prompt_id"] for e in crowd_received}
    triaged_ids = {e["prompt_id"] for e in triage}
    routed_ids = {e["prompt_id"] for e in routes}
    answered_ids = {e["prompt_id"] for e in answers}

    # replay hours = 24 for a full day; prompts/hour from crowd volume.
    per_replay_hour = len(crowd_received) / 24.0

    # gear mix on crowd routes.
    crowd_routes = [e for e in routes if e["prompt_id"] in crowd_ids]
    gear_mix = Counter(e.get("gear_used") for e in crowd_routes)

    # downshift = gear_used < gear_needed, split by grid level at route time.
    red = {"down": 0, "total": 0}
    notred = {"down": 0, "total": 0}
    for e in crowd_routes:
        bucket = red if e.get("_grid_level") == "red" else notred
        bucket["total"] += 1
        if int(e.get("gear_used", 0)) < int(e.get("gear_needed", 0)):
            bucket["down"] += 1

    energy_mix = Counter(e.get("energy_source") for e in answers if e["prompt_id"] in crowd_ids)

    report = {
        "speed": speed,
        "crowd_prompts": len(crowd_received),
        "prompts_per_replay_hour": round(per_replay_hour, 1),
        "triaged": len(crowd_ids & triaged_ids),
        "routed": len(crowd_ids & routed_ids),
        "answered": len(crowd_ids & answered_ids),
        "every_prompt_triaged": crowd_ids <= triaged_ids,
        "every_prompt_routed": crowd_ids <= routed_ids,
        "gear_mix": dict(sorted(gear_mix.items(), key=lambda kv: (kv[0] is None, kv[0]))),
        "downshift_red": red,
        "downshift_not_red": notred,
        "energy_source_mix": dict(energy_mix),
        "real_attempts": stats.get("real_attempts", 0),
        "real_ok": stats.get("real_ok", 0),
        "real_fallback": stats.get("real_fallback", 0),
        "dropped_backpressure": stats.get("dropped_backpressure", 0),
        "coordinator_reports": len(of("coordinator.report")),
        "utility_requests": len(of("utility.request")),
        "utility_verdicts": len(of("utility.verdict")),
        "grid_states": len(of("grid.state")),
    }
    return report


def _print(report: dict) -> None:
    print("\n==== CROWD SIM INTEGRATION REPORT ====")
    for k, v in report.items():
        print(f"  {k}: {v}")
    print("======================================\n")


if __name__ == "__main__":
    spd = float(sys.argv[1]) if len(sys.argv) > 1 else 14400.0
    _print(run(spd))

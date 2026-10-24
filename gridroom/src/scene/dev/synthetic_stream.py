"""DEV ONLY. Synthetic event stream for working on the Grid Room scene.

These events are SIMULATED test data, not measurements. This wraps the real
engine app (engine.app.app) and adds a background task that publishes
plausible prompt.received / route.decided / power.sample / grid.state events on
the real bus, so the real WS /v1/stream (and therefore the scene) can be
exercised before the crowd simulator (B6) and answer endpoint (A8) exist.

Run from the repo root:

    .venv\\Scripts\\python.exe -m uvicorn synthetic_stream:app ^
        --app-dir gridroom/src/scene/dev --port 8000

Env knobs: SYNTH_RATE (prompts/second, default 12), SYNTH_LEVEL_PERIOD
(seconds per grid level step, default 8).
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from engine.app import app  # noqa: E402
from engine.bus import bus  # noqa: E402

CENTROIDS = json.loads(
    (Path(__file__).resolve().parent.parent / "data" / "town-centroids.json")
    .read_text(encoding="utf-8")
)
TOWNS = list(CENTROIDS)
MODELS = {1: "qwen2.5:0.5b", 2: "llama3.2:1b", 3: "llama3.2:3b", 4: "llama3.1:8b", 5: "bedrock-gear-5"}
LEVELS = ["green", "yellow", "red", "yellow"]
# chance that a prompt is shifted one gear down, by grid level
SHIFT_P = {"green": 0.0, "yellow": 0.1, "red": 0.7}

RATE = float(os.environ.get("SYNTH_RATE", "12"))
PERIOD = float(os.environ.get("SYNTH_LEVEL_PERIOD", "8"))


async def _prompts(state: dict) -> None:
    n = 0
    while True:
        await asyncio.sleep(1.0 / RATE)
        n += 1
        pid = f"synth-{n}"
        needed = random.choices([1, 2, 3, 4, 5], weights=[30, 30, 25, 10, 5])[0]
        used = needed - 1 if needed > 1 and random.random() < SHIFT_P[state["level"]] else needed
        await bus.publish({
            "type": "prompt.received", "prompt_id": pid, "source": "crowd",
            "chars": random.randint(10, 400), "town": random.choice(TOWNS),
        })
        await bus.publish({
            "type": "route.decided", "prompt_id": pid, "gear_needed": needed,
            "gear_used": used, "model": MODELS[used], "deferred": False,
            "protected": False, "reason": "synthetic test event",
        })


async def _grid(state: dict) -> None:
    i = 0
    while True:
        state["level"] = LEVELS[i % len(LEVELS)]
        mw = {"green": 18500.0, "yellow": 22000.0, "red": 25000.0}[state["level"]]
        await bus.publish({
            "type": "grid.state", "load_mw": mw, "level": state["level"],
            "replay_clock": "synthetic", "source": "replay",
        })
        i += 1
        await asyncio.sleep(PERIOD)


async def _power(state: dict) -> None:
    while True:
        base = {"green": 80.0, "yellow": 65.0, "red": 48.0}[state["level"]]
        await bus.publish({
            "type": "power.sample", "watts": base + random.uniform(-6, 6),
            "device": "synthetic", "source": "estimate",
        })
        await asyncio.sleep(0.5)


@app.on_event("startup")
async def _start_synthetic() -> None:
    state = {"level": "green"}
    for coro in (_prompts(state), _grid(state), _power(state)):
        asyncio.create_task(coro)
    print("[synthetic_stream] publishing SIMULATED events (dev only)")

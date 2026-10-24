"""JOINT: replays fixture events so A and B build UIs before agents exist.

Two ways to use it:

1) Against a running engine over WebSocket is NOT how this works (clients only
   receive). Instead, run the engine with the mock registered:

       DOWNSHIFT_MOCK=1 uvicorn engine.app:app --port 8000

   When DOWNSHIFT_MOCK is set, engine.app imports this module's register(),
   which loops the demo scenario onto the bus (so every WS client sees it).

2) Standalone pretty-print of the scenario (no engine needed):

       python -m engine.mock_stream --print
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

SCENARIO = (
    Path(__file__).resolve().parent.parent
    / "contracts" / "fixtures" / "scenario.demo.json"
)


def load_sequence() -> list[dict]:
    data = json.loads(SCENARIO.read_text(encoding="utf-8"))
    return data["sequence"]


async def _run_loop(bus, loop_forever: bool = True) -> None:
    seq = load_sequence()
    while True:
        for step in seq:
            await asyncio.sleep(step.get("delay_ms", 0) / 1000.0)
            await bus.publish(dict(step["event"]))
        if not loop_forever:
            return
        await asyncio.sleep(2.0)


def register(bus, app):
    """Started by engine.app only when DOWNSHIFT_MOCK is set."""
    if not os.environ.get("DOWNSHIFT_MOCK"):
        return

    @app.on_event("startup")
    async def _start_mock():
        asyncio.create_task(_run_loop(bus, loop_forever=True))

    print("[mock_stream] enabled: replaying scenario.demo.json on the bus")


def _print() -> None:
    for step in load_sequence():
        print(f"+{step.get('delay_ms', 0):>5}ms  {json.dumps(step['event'])}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--print", action="store_true", help="print the scenario and exit")
    args = parser.parse_args()
    if args.print:
        _print()
    else:
        print("Use --print, or run the engine with DOWNSHIFT_MOCK=1.")

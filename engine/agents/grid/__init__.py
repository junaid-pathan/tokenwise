"""A (PR A5): Grid agent. Plain rules on load.

Listens: grid.load (from B's replay) or the live EIA feed.
Emits: grid.state on every grid.load. Serves GET /v1/grid, POST /v1/demo/alert.

Thresholds come from contracts/gears.json ("levels"):
    green  <= 20,000 MW
    yellow <= 23,500 MW
    red     > 23,500 MW
so June-24 afternoon (~24,180 MW) lands red.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException

_GEARS_PATH = (
    Path(__file__).resolve().parents[3] / "contracts" / "gears.json"
)

_VALID_LEVELS = ("green", "yellow", "red")


def _load_thresholds() -> tuple[float, float]:
    """Return (green_max_mw, yellow_max_mw) from the frozen gears.json."""
    data = json.loads(_GEARS_PATH.read_text(encoding="utf-8"))
    levels = data["levels"]
    return float(levels["green"]["max_mw"]), float(levels["yellow"]["max_mw"])


def register(bus, app):
    green_max, yellow_max = _load_thresholds()
    # latest grid.state body served by GET /v1/grid
    state: dict = {"latest": None}

    def level_for(load_mw: float) -> str:
        if load_mw <= green_max:
            return "green"
        if load_mw <= yellow_max:
            return "yellow"
        return "red"

    async def on_grid_load(ev: dict) -> None:
        st = {
            "type": "grid.state",
            "load_mw": ev["load_mw"],
            "level": level_for(ev["load_mw"]),
            "replay_clock": ev.get("replay_clock", ""),
            "source": ev.get("source", "replay"),
        }
        state["latest"] = st
        await bus.publish(st)

    bus.subscribe("grid.load", on_grid_load)

    @app.get("/v1/grid")
    async def get_grid() -> dict:
        """Latest grid.state body, or an empty green default before any load."""
        if state["latest"] is not None:
            return state["latest"]
        return {
            "type": "grid.state",
            "load_mw": 0.0,
            "level": "green",
            "replay_clock": "",
            "source": "replay",
        }

    @app.post("/v1/demo/alert")
    async def demo_alert(body: dict) -> dict:
        """Manual Grid Alert for the demo: {level} -> publish a grid.state."""
        level = body.get("level")
        if level not in _VALID_LEVELS:
            raise HTTPException(
                status_code=422,
                detail=f"level must be one of {_VALID_LEVELS}",
            )
        # keep the last known load if we have one, else a representative value
        last = state["latest"] or {}
        st = {
            "type": "grid.state",
            "load_mw": float(last.get("load_mw", 0.0)),
            "level": level,
            "replay_clock": last.get("replay_clock", ""),
            "source": "live",
        }
        state["latest"] = st
        await bus.publish(st)
        return st

    return None

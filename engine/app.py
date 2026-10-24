"""JOINT, frozen wiring: FastAPI app. Imports every module's register(bus, app).

Run:
    uvicorn engine.app:app --reload --port 8000           # real agents
    uvicorn engine.app:app --port 8000  (then run mock)   # see mock_stream.py

Do NOT edit without a joint `contract:` PR both owners approve. Agents wire
themselves in via their own register() in their own folder.
"""

from __future__ import annotations

import importlib

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from engine.bus import bus

app = FastAPI(title="Downshift engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every agent/module that owns an HTTP route or bus subscription exposes
# register(bus, app). Add new modules here only via a joint contract: PR.
MODULES = [
    "engine.api",                 # A: /v1/answer, /v1/triage proxy
    "engine.power",               # A: power sampling
    "engine.metrics",             # A: scorecard
    "engine.replay",              # B: /v1/demo/replay
    "engine.agents.triage",       # A
    "engine.agents.coordinator",  # A
    "engine.agents.grid",         # A
    "engine.agents.utility",      # B
    "engine.agents.narrator",     # B
    "sim.crowd",                  # B: simulated MA-town users (inert until grid.load; CROWD_SIM=0 disables)
    "engine.mock_stream",         # JOINT: only active when DOWNSHIFT_MOCK=1
]


@app.on_event("startup")
async def _register_all() -> None:
    for name in MODULES:
        try:
            mod = importlib.import_module(name)
        except Exception as exc:
            print(f"[app] skip {name}: import failed ({exc})")
            continue
        register = getattr(mod, "register", None)
        if register is None:
            print(f"[app] skip {name}: no register()")
            continue
        try:
            maybe = register(bus, app)
            if hasattr(maybe, "__await__"):
                await maybe
            print(f"[app] registered {name}")
        except Exception as exc:
            print(f"[app] register failed for {name}: {exc}")


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "events_buffered": len(bus.history)}


@app.websocket("/v1/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    backlog = bus.add_ws(ws)
    try:
        for event in backlog:  # last 50 on connect
            await ws.send_json(event)
        while True:
            # We don't expect inbound messages; keep the socket open.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        bus.remove_ws(ws)

"""A (PR A8): /v1/answer. Routes a prompt to a gear, generates, reads energy,
and emits answer.completed.

Flow:
  * mode "auto"   -> rules triage picks the gear.
  * mode "gear N" -> use gear N exactly.
  * protected=true is passed through on the event (never downshifted elsewhere).

Generation goes through engine.llm (Ollama for Gears 1-4, stub otherwise). Energy
is measured with engine.power.energy_between around the call; it reports
"measured" from the live Colab meter or "estimated" on fallback.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid

from fastapi import HTTPException

from engine import llm, power
from engine.llm import ollama
from engine.agents import triage

_GEAR_RE = re.compile(r"^\s*gear\s+([1-5])\s*$", re.IGNORECASE)


def _generate(gear: int, prompt: str):
    """Pick the backend: Ollama for Gears 1-4 (Colab host), stub otherwise or on
    failure, so /v1/answer always returns something for the demo loop."""
    if 1 <= gear <= 4:
        try:
            return ollama.generate(gear, prompt)
        except Exception as exc:  # tunnel down / model missing -> degrade, don't 500
            print(f"[api] ollama gear {gear} failed ({exc}); using stub")
    return llm.generate(gear, prompt)


def _resolve_gear(mode: str, prompt: str) -> int:
    """Return the gear to use for this request from the mode string."""
    mode = (mode or "auto").strip()
    if mode.lower() == "auto":
        gear, _conf, _reason = triage.classify_text(prompt)
        return gear
    m = _GEAR_RE.match(mode)
    if m:
        return int(m.group(1))
    raise HTTPException(
        status_code=422, detail='mode must be "auto" or "gear N" (N in 1-5)'
    )


def register(bus, app):
    # route.decided per prompt_id, so /v1/answer can follow the Coordinator.
    routes: dict[str, dict] = {}

    async def _on_route(ev: dict) -> None:
        routes[ev.get("prompt_id")] = ev

    bus.subscribe("route.decided", _on_route)

    @app.post("/v1/answer")
    async def answer(body: dict) -> dict:
        prompt = body.get("prompt")
        if not prompt or not isinstance(prompt, str):
            raise HTTPException(status_code=422, detail="prompt is required")
        mode = body.get("mode", "auto")
        protected = bool(body.get("protected", False))
        prompt_id = body.get("prompt_id") or ("ext-" + uuid.uuid4().hex[:8])
        # Where the prompt came from; the extension panel is "extension". A town
        # lets the Grid Room spark from a location (optional, defaults sensibly).
        source = body.get("source", "extension")
        town = body.get("town")

        gear = _resolve_gear(mode, prompt)
        if mode.strip().lower() == "auto":
            # Hand the real text-based triage to the Triage agent, which would
            # otherwise only see `chars` on prompt.received.
            triage.HINTS[prompt_id] = triage.classify_text(prompt)

        # Announce the prompt so the real Triage + Coordinator route it: that
        # produces triage.decided + route.decided for this prompt_id, which the
        # Grid Room sparks on and the Coordinator/scorecard account for.
        received = {
            "type": "prompt.received",
            "prompt_id": prompt_id,
            "source": source,
            "chars": len(prompt),
        }
        if town:
            received["town"] = town
        await bus.publish(received)

        # prompt.received -> Triage -> Coordinator -> route.decided has run inline
        # (bus.publish awaits its handlers). In auto mode the Coordinator's gear
        # wins: it is the grid-aware one (one gear down when red). An explicit
        # "gear N" is an override and is kept. Protected prompts are never shifted.
        route = routes.pop(prompt_id, None)
        if mode.strip().lower() == "auto" and route and not protected:
            gear = int(route["gear_used"])
        triage.HINTS.pop(prompt_id, None)

        # Generate, timing the call so we can integrate energy over the window.
        # Generate off the event loop so the async power sampler keeps polling
        # during the call (otherwise the answer window has no samples and energy
        # falls back to estimated).
        t0 = time.time()
        result = await asyncio.to_thread(_generate, gear, prompt)
        t1 = time.time()

        energy_j, energy_source = power.energy_between(t0, t1)

        completed = {
            "type": "answer.completed",
            "prompt_id": prompt_id,
            "gear_used": gear,
            "latency_ms": result["latency_ms"],
            "output_tokens": result["output_tokens"],
            "energy_j": round(energy_j, 2),
            "energy_source": energy_source,
        }
        await bus.publish(completed)

        return {
            "text": result["text"],
            "gear_used": gear,
            "model": result["model"],
            "latency_ms": result["latency_ms"],
            "energy_j": round(energy_j, 2),
            "energy_source": energy_source,
        }

    return None

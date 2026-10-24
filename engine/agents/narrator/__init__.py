"""B (PR B5): Narrator. Plain-language play-by-play for the Grid Room.

Listens: coordinator.commit, coordinator.report, utility.verdict, utility.request
(context) and grid.state LEVEL CHANGES only (a repeated same-level state is
ignored). Emits: narrator.line {text, refs} where refs are the ids of the events
the line describes.

Guarantees:
  * At most ONE narrator.line per NARRATOR_INTERVAL_S real seconds (module
    constant so tests can shorten it).
  * Each line is <= 18 words.
  * EVERY number in a line appears in the cited events, else the deterministic
    template line is used (guard.line_ok). We never publish an unverified line.

Rate-limit / coalesce policy:
  Incoming events become "facts" (templates.fact_from_event). Facts are held in
  a small pending map keyed by fact kind, so a burst of the SAME kind coalesces
  to its latest value (e.g. repeated grid levels never flood). A background
  drainer wakes every interval and publishes exactly one line: the highest
  priority pending fact (verdict > report > commit > request > grid level;
  ties broken by most-recent arrival). This never blocks the bus publish path:
  handlers only enqueue and return immediately.

LLM: when enabled (NARRATOR_USE_LLM, credentials present) and under the
NARRATOR_MAX_LLM_CALLS budget, a fast Bedrock model rephrases the template line;
the result is re-checked by the SAME guard and any failure falls back to the
template. Users never see the words "model" or "tokens".
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

from . import guard, llm_line, templates

# One line at most per this many real seconds. Overridable for tests.
NARRATOR_INTERVAL_S = float(os.environ.get("NARRATOR_INTERVAL_S", "8"))

# Event types the Narrator reacts to.
_LISTEN = (
    "coordinator.commit",
    "coordinator.report",
    "utility.verdict",
    "utility.request",
    "grid.state",
)


class NarratorAgent:
    """Collects facts, rate-limits, guards, and publishes narrator.line."""

    def __init__(self, bus, interval_s: Optional[float] = None) -> None:
        self.bus = bus
        self.interval_s = NARRATOR_INTERVAL_S if interval_s is None else interval_s
        # pending facts keyed by kind -> (seq, fact); newest value per kind wins
        self._pending: dict[str, tuple[int, dict]] = {}
        self._seq = 0
        self._prev_level: Optional[str] = None
        self._lock = asyncio.Lock()
        self._drainer: Optional[asyncio.Task] = None
        self._stopped = False
        self._budget = llm_line.LlmBudget()
        # Injectable Bedrock converse() for tests; None -> use the real client.
        self.converse = None
        # For tests/inspection: every line published, as (text, refs).
        self.published: list[dict] = []

    # --- bus handler (never blocks) --------------------------------------
    async def on_event(self, event: dict) -> None:
        """Enqueue a fact for later narration. Returns immediately."""
        etype = event.get("type")
        if etype not in _LISTEN:
            return

        if etype == "grid.state":
            fact = templates.fact_from_event(event, prev_level=self._prev_level)
            # Track level regardless of whether we narrate it.
            self._prev_level = event.get("level")
            if fact is None:
                return  # no level change
        else:
            fact = templates.fact_from_event(event)
            if fact is None:
                return

        async with self._lock:
            self._seq += 1
            self._pending[fact["kind"]] = (self._seq, fact)

    # --- drainer loop -----------------------------------------------------
    async def _drain_loop(self) -> None:
        while not self._stopped:
            await asyncio.sleep(self.interval_s)
            await self.drain_once()

    async def drain_once(self) -> Optional[dict]:
        """Publish the single most important pending fact, if any.

        Exposed for tests so the rate limiter can be driven deterministically.
        """
        async with self._lock:
            if not self._pending:
                return None
            # Pick highest priority; break ties by most-recent arrival (seq).
            kind, (seq, fact) = max(
                self._pending.items(),
                key=lambda item: (item[1][1]["priority"], item[1][0]),
            )
            del self._pending[kind]

        line = await self._render_line(fact)
        event = {"type": "narrator.line", "text": line, "refs": list(fact["refs"])}
        await self.bus.publish(event)
        self.published.append({"text": line, "refs": list(fact["refs"])})
        return event

    # --- line rendering (template, optionally upgraded by the LLM) -------
    async def _render_line(self, fact: dict) -> str:
        template = fact["text"]
        events = fact["events"]

        # The template is deterministic and built from event fields, but still
        # verify it (word limit); if somehow too long, we have no safer option
        # than the template itself, so return it.
        if not llm_line.llm_enabled() or not self._budget.available():
            return template

        numbers = guard.extract_numbers(template)
        self._budget.spend()
        candidate = await llm_line.phrase_line(template, numbers, converse=self.converse)
        if candidate and guard.line_ok(candidate, events):
            return candidate
        return template

    # --- lifecycle --------------------------------------------------------
    def start(self) -> None:
        if self._drainer is None:
            self._stopped = False
            self._drainer = asyncio.create_task(self._drain_loop())

    async def stop(self) -> None:
        self._stopped = True
        if self._drainer is not None:
            self._drainer.cancel()
            try:
                await self._drainer
            except (asyncio.CancelledError, Exception):
                pass
            self._drainer = None


def register(bus, app):
    """Wire the Narrator into the shared bus and FastAPI app."""
    agent = NarratorAgent(bus)

    for etype in _LISTEN:
        bus.subscribe(etype, agent.on_event)

    # register() runs inside engine.app's own startup handler, so a loop is
    # already running: start the drainer now. (A late-added startup handler
    # would never fire.) Fall back to a shutdown hook for cleanup.
    try:
        asyncio.get_running_loop()
        agent.start()
    except RuntimeError:  # pragma: no cover - no loop (unusual)
        @app.on_event("startup")
        async def _start_narrator() -> None:
            agent.start()

    @app.on_event("shutdown")
    async def _stop_narrator() -> None:  # pragma: no cover
        await agent.stop()

    app.state.narrator_agent = agent
    return agent

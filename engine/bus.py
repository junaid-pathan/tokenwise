"""JOINT, frozen wiring: in-process async pub/sub + WebSocket broadcast.

Do NOT edit without a joint `contract:` PR both owners approve.

Usage in an agent's register(bus, app):
    bus.subscribe("grid.state", my_handler)      # async def handler(event: dict)
    await bus.publish({"type": "grid.state", ...})  # dict or pydantic .model_dump()
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Awaitable, Callable

Handler = Callable[[dict], Awaitable[None]]


class Bus:
    def __init__(self, history: int = 50) -> None:
        self._subs: dict[str, list[Handler]] = defaultdict(list)
        self._wildcard: list[Handler] = []
        self._ws_clients: set[Any] = set()
        self._history: deque[dict] = deque(maxlen=history)

    # --- pub/sub ----------------------------------------------------------
    def subscribe(self, event_type: str, handler: Handler) -> None:
        """Subscribe to one event type, or '*' for all events."""
        if event_type == "*":
            self._wildcard.append(handler)
        else:
            self._subs[event_type].append(handler)

    async def publish(self, event: dict) -> None:
        """Publish a dict event. Stamps id/ts if missing, fans out, broadcasts to WS."""
        event.setdefault("id", uuid.uuid4().hex)
        event.setdefault("ts", int(time.time() * 1000))
        self._history.append(event)

        handlers = list(self._subs.get(event["type"], ())) + list(self._wildcard)
        if handlers:
            await asyncio.gather(
                *(_safe(h, event) for h in handlers), return_exceptions=True
            )
        await self._broadcast(event)

    # --- websocket --------------------------------------------------------
    def add_ws(self, ws: Any) -> list[dict]:
        """Register a WS client. Returns the last N events to replay on connect."""
        self._ws_clients.add(ws)
        return list(self._history)

    def remove_ws(self, ws: Any) -> None:
        self._ws_clients.discard(ws)

    async def _broadcast(self, event: dict) -> None:
        dead = []
        for ws in list(self._ws_clients):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._ws_clients.discard(ws)

    @property
    def history(self) -> list[dict]:
        return list(self._history)


async def _safe(handler: Handler, event: dict) -> None:
    try:
        await handler(event)
    except Exception as exc:  # never let one subscriber kill a publish
        print(f"[bus] handler error on {event.get('type')}: {exc}")


# Single shared instance the whole engine uses.
bus = Bus()

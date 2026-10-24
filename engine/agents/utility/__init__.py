"""B (PR B4): Utility agent. Deterministic negotiator.

Listens: grid.state, coordinator.commit, coordinator.report.
Emits: utility.request, utility.verdict. Serves POST /v1/utility/request.

Rules (deterministic):
- grid.state level == "red" for 2 samples in a row -> emit utility.request
  with cut_pct 25 and duration_min 120, reason "grid red for 2 samples".
- Only one active request at a time (no spam). A new auto request is allowed
  again once the previous one is resolved (final verdict) OR the grid goes
  back to a non-red level.
- coordinator.commit: record the committed cut for the active request.
- coordinator.report for the active request_id:
    shortfall_pct = max(0, requested cut_pct - achieved_cut_pct)
    if shortfall_pct <= 3: utility.verdict accepted=true (request resolved).
    if shortfall_pct > 3 and not yet escalated: utility.verdict accepted=false
      + re-request ONCE with escalation cut_pct = min(50, requested + shortfall),
      duration_min carried over, new request_id.
    if shortfall_pct > 3 and already escalated: final utility.verdict
      accepted=false, NO third request (request resolved).
- POST /v1/utility/request {cut_pct, duration_min}: validate cut_pct in [0,100]
  and duration_min > 0, emit utility.request, return {request_id}.

State lives in the UtilityAgent class so it is unit-testable without the app.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

# Escalation / verdict thresholds (deterministic, PRD B4).
SHORTFALL_TOLERANCE_PTS = 3.0  # shortfall <= 3 points is accepted
RED_SAMPLES_TO_TRIGGER = 2     # consecutive red grid.state samples to auto-request
AUTO_CUT_PCT = 25.0            # default auto cut on sustained red
AUTO_DURATION_MIN = 120        # replay minutes
MAX_CUT_PCT = 50.0             # escalation cap


class UtilityAgent:
    """Deterministic negotiator. Holds all mutable state for one engine run."""

    def __init__(self, bus) -> None:
        self.bus = bus
        self._req_counter = 0
        self._red_streak = 0
        # Active request tracking. None when nothing is in flight.
        self.active_request_id: Optional[str] = None
        self.active_cut_pct: float = 0.0
        self.active_duration_min: int = 0
        self.active_escalated: bool = False
        self.committed_cut_pct: Optional[float] = None

    # --- id helper --------------------------------------------------------
    def _next_request_id(self) -> str:
        self._req_counter += 1
        return f"r-{self._req_counter}"

    # --- request helpers --------------------------------------------------
    async def _emit_request(
        self, cut_pct: float, duration_min: int, reason: str, *, escalated: bool
    ) -> str:
        request_id = self._next_request_id()
        self.active_request_id = request_id
        self.active_cut_pct = float(cut_pct)
        self.active_duration_min = int(duration_min)
        self.active_escalated = escalated
        self.committed_cut_pct = None
        await self.bus.publish(
            {
                "type": "utility.request",
                "request_id": request_id,
                "cut_pct": float(cut_pct),
                "duration_min": int(duration_min),
                "reason": reason,
            }
        )
        return request_id

    def _resolve_active(self) -> None:
        """Clear the active request so a new auto request may be issued."""
        self.active_request_id = None
        self.active_escalated = False
        self.committed_cut_pct = None

    # --- bus handlers -----------------------------------------------------
    async def on_grid_state(self, event: dict) -> None:
        level = event.get("level")
        if level == "red":
            self._red_streak += 1
            if (
                self._red_streak >= RED_SAMPLES_TO_TRIGGER
                and self.active_request_id is None
            ):
                await self._emit_request(
                    AUTO_CUT_PCT,
                    AUTO_DURATION_MIN,
                    "grid red for 2 samples",
                    escalated=False,
                )
        else:
            # Grid recovered: reset streak and free the active slot so the next
            # sustained red can trigger a fresh request.
            self._red_streak = 0
            self._resolve_active()

    async def on_commit(self, event: dict) -> None:
        if event.get("request_id") == self.active_request_id:
            self.committed_cut_pct = float(event.get("committed_cut_pct", 0.0))

    async def on_report(self, event: dict) -> None:
        if event.get("request_id") != self.active_request_id:
            return  # stale/unknown report; ignore

        achieved = float(event.get("achieved_cut_pct", 0.0))
        requested = self.active_cut_pct
        shortfall = max(0.0, requested - achieved)

        if shortfall <= SHORTFALL_TOLERANCE_PTS:
            await self.bus.publish(
                {
                    "type": "utility.verdict",
                    "request_id": self.active_request_id,
                    "accepted": True,
                    "shortfall_pct": round(shortfall, 4),
                }
            )
            self._resolve_active()
            return

        # shortfall > tolerance
        if not self.active_escalated:
            # Reject this attempt, then escalate exactly once.
            await self.bus.publish(
                {
                    "type": "utility.verdict",
                    "request_id": self.active_request_id,
                    "accepted": False,
                    "shortfall_pct": round(shortfall, 4),
                }
            )
            new_cut = min(MAX_CUT_PCT, requested + shortfall)
            await self._emit_request(
                new_cut,
                self.active_duration_min,
                f"escalation after {round(shortfall, 1)} pt shortfall",
                escalated=True,
            )
            return

        # Already escalated: final verdict, no third request.
        await self.bus.publish(
            {
                "type": "utility.verdict",
                "request_id": self.active_request_id,
                "accepted": False,
                "shortfall_pct": round(shortfall, 4),
            }
        )
        self._resolve_active()

    # --- manual request (HTTP) -------------------------------------------
    async def manual_request(self, cut_pct: float, duration_min: int) -> str:
        """Emit a manually-triggered utility.request. Caller validates inputs."""
        return await self._emit_request(
            cut_pct,
            duration_min,
            "manual request",
            escalated=False,
        )


class UtilityRequestBody(BaseModel):
    """Body for POST /v1/utility/request (module-level so FastAPI resolves it)."""

    cut_pct: float = Field(..., description="Percent cut requested, 0-100.")
    duration_min: int = Field(..., description="Duration in replay minutes, > 0.")


def register(bus, app):
    """Wire the Utility agent into the shared bus and FastAPI app."""
    from fastapi import HTTPException

    agent = UtilityAgent(bus)

    bus.subscribe("grid.state", agent.on_grid_state)
    bus.subscribe("coordinator.commit", agent.on_commit)
    bus.subscribe("coordinator.report", agent.on_report)

    @app.post("/v1/utility/request")
    async def post_utility_request(body: UtilityRequestBody) -> dict:
        if not (0.0 <= body.cut_pct <= 100.0):
            raise HTTPException(status_code=422, detail="cut_pct must be between 0 and 100")
        if body.duration_min <= 0:
            raise HTTPException(status_code=422, detail="duration_min must be > 0")
        request_id = await agent.manual_request(body.cut_pct, body.duration_min)
        return {"request_id": request_id}

    # Expose the agent for tests/introspection.
    app.state.utility_agent = agent
    return agent

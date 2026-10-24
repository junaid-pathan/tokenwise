"""FROZEN after Phase 0. The single source of truth for every event on the bus.

Every event has `type`, `id`, `ts`. All events go out on WS /v1/stream.
Mirrored by hand in contracts/events.ts. If you change one, change both in a
joint `contract:` PR that both owners approve.

Owners (see PRD Team split):
  A = Aru (demand side), B = Junaid (supply side).
"""

from __future__ import annotations

import time
import uuid
from typing import Literal, Optional

from pydantic import BaseModel, Field


def _new_id() -> str:
    return uuid.uuid4().hex


def _now_ms() -> int:
    return int(time.time() * 1000)


class Event(BaseModel):
    """Base for every event. Subclasses set a literal `type`."""

    type: str
    id: str = Field(default_factory=_new_id)
    ts: int = Field(default_factory=_now_ms)


# --- demand / routing -------------------------------------------------------

class PromptReceived(Event):
    type: Literal["prompt.received"] = "prompt.received"
    prompt_id: str
    source: Literal["extension", "crowd", "api"]
    chars: int
    town: Optional[str] = None


class TriageDecided(Event):
    type: Literal["triage.decided"] = "triage.decided"
    prompt_id: str
    gear_needed: int  # 1-5
    confidence: float
    reason: str


class RouteDecided(Event):
    type: Literal["route.decided"] = "route.decided"
    prompt_id: str
    gear_needed: int
    gear_used: int
    model: str
    deferred: bool = False
    protected: bool = False
    reason: str


class AnswerCompleted(Event):
    type: Literal["answer.completed"] = "answer.completed"
    prompt_id: str
    gear_used: int
    latency_ms: int
    output_tokens: int
    energy_j: float
    energy_source: Literal["measured", "estimated"]


# --- grid -------------------------------------------------------------------

class GridLoad(Event):
    type: Literal["grid.load"] = "grid.load"
    load_mw: float
    replay_clock: str  # ISO-ish clock string of the replayed moment
    source: Literal["replay", "live"]


class GridState(Event):
    type: Literal["grid.state"] = "grid.state"
    load_mw: float
    level: Literal["green", "yellow", "red"]
    replay_clock: str
    source: Literal["replay", "live"]


# --- negotiation ------------------------------------------------------------

class UtilityRequest(Event):
    type: Literal["utility.request"] = "utility.request"
    request_id: str
    cut_pct: float
    duration_min: int
    reason: str


class CoordinatorPolicy(BaseModel):
    gear_offset: int = 0
    defer_batch: bool = False
    protect_critical: bool = True


class CoordinatorCommit(Event):
    type: Literal["coordinator.commit"] = "coordinator.commit"
    request_id: str
    committed_cut_pct: float
    policy: CoordinatorPolicy


class CoordinatorReport(Event):
    type: Literal["coordinator.report"] = "coordinator.report"
    request_id: str
    achieved_cut_pct: float
    joules_baseline: float
    joules_actual: float


class UtilityVerdict(Event):
    type: Literal["utility.verdict"] = "utility.verdict"
    request_id: str
    accepted: bool
    shortfall_pct: float


# --- power / metrics / narrator --------------------------------------------

class PowerSample(Event):
    type: Literal["power.sample"] = "power.sample"
    watts: float
    device: str
    source: Literal["nvidia-smi", "cloud", "estimate"]


class ScorecardSide(BaseModel):
    j_per_answer: float
    quality_match_pct: float
    p50_latency_ms: float


class ScorecardUpdate(Event):
    type: Literal["scorecard.update"] = "scorecard.update"
    no_downshift: ScorecardSide
    downshift: ScorecardSide


class NarratorLine(Event):
    type: Literal["narrator.line"] = "narrator.line"
    text: str
    refs: list[str] = Field(default_factory=list)  # event ids it describes


# Registry for mock_stream and validation.
EVENT_MODELS = {
    "prompt.received": PromptReceived,
    "triage.decided": TriageDecided,
    "route.decided": RouteDecided,
    "answer.completed": AnswerCompleted,
    "grid.load": GridLoad,
    "grid.state": GridState,
    "utility.request": UtilityRequest,
    "coordinator.commit": CoordinatorCommit,
    "coordinator.report": CoordinatorReport,
    "utility.verdict": UtilityVerdict,
    "power.sample": PowerSample,
    "scorecard.update": ScorecardUpdate,
    "narrator.line": NarratorLine,
}

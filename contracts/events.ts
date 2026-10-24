// FROZEN after Phase 0. Hand-mirrored from contracts/events.py.
// If you change one, change both in a joint `contract:` PR that both owners approve.
// Owners: A = Aru (demand side), B = Junaid (supply side).

export type GridLevel = "green" | "yellow" | "red";
export type EnergySource = "measured" | "estimated";
export type PowerSource = "nvidia-smi" | "cloud" | "estimate";
export type ReplaySource = "replay" | "live";
export type PromptSource = "extension" | "crowd" | "api";

export interface BaseEvent {
  type: string;
  id: string;
  ts: number;
}

export interface PromptReceived extends BaseEvent {
  type: "prompt.received";
  prompt_id: string;
  source: PromptSource;
  chars: number;
  town?: string | null;
}

export interface TriageDecided extends BaseEvent {
  type: "triage.decided";
  prompt_id: string;
  gear_needed: number; // 1-5
  confidence: number;
  reason: string;
}

export interface RouteDecided extends BaseEvent {
  type: "route.decided";
  prompt_id: string;
  gear_needed: number;
  gear_used: number;
  model: string;
  deferred: boolean;
  protected: boolean;
  reason: string;
}

export interface AnswerCompleted extends BaseEvent {
  type: "answer.completed";
  prompt_id: string;
  gear_used: number;
  latency_ms: number;
  output_tokens: number;
  energy_j: number;
  energy_source: EnergySource;
}

export interface GridLoad extends BaseEvent {
  type: "grid.load";
  load_mw: number;
  replay_clock: string;
  source: ReplaySource;
}

export interface GridState extends BaseEvent {
  type: "grid.state";
  load_mw: number;
  level: GridLevel;
  replay_clock: string;
  source: ReplaySource;
}

export interface UtilityRequest extends BaseEvent {
  type: "utility.request";
  request_id: string;
  cut_pct: number;
  duration_min: number;
  reason: string;
}

export interface CoordinatorPolicy {
  gear_offset: number;
  defer_batch: boolean;
  protect_critical: boolean;
}

export interface CoordinatorCommit extends BaseEvent {
  type: "coordinator.commit";
  request_id: string;
  committed_cut_pct: number;
  policy: CoordinatorPolicy;
}

export interface CoordinatorReport extends BaseEvent {
  type: "coordinator.report";
  request_id: string;
  achieved_cut_pct: number;
  joules_baseline: number;
  joules_actual: number;
}

export interface UtilityVerdict extends BaseEvent {
  type: "utility.verdict";
  request_id: string;
  accepted: boolean;
  shortfall_pct: number;
}

export interface PowerSample extends BaseEvent {
  type: "power.sample";
  watts: number;
  device: string;
  source: PowerSource;
}

export interface ScorecardSide {
  j_per_answer: number;
  quality_match_pct: number;
  p50_latency_ms: number;
}

export interface ScorecardUpdate extends BaseEvent {
  type: "scorecard.update";
  no_downshift: ScorecardSide;
  downshift: ScorecardSide;
}

export interface NarratorLine extends BaseEvent {
  type: "narrator.line";
  text: string;
  refs: string[];
}

export type DownshiftEvent =
  | PromptReceived
  | TriageDecided
  | RouteDecided
  | AnswerCompleted
  | GridLoad
  | GridState
  | UtilityRequest
  | CoordinatorCommit
  | CoordinatorReport
  | UtilityVerdict
  | PowerSample
  | ScorecardUpdate
  | NarratorLine;

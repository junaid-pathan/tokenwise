// Pure demo-control logic for B9. No React, no three. Unit-testable in Node.
//
// Maps the presenter's keys to engine calls, and classifies events that come
// from simulated / replayed / estimated sources so the scene can label them.
//   R      replay June 24, 2025 at the current speed
//   1-3    replay at slow / normal / fast speed
//   A      toggle a manual Grid Alert (red <-> green)
//   X      reset: grid back to green, sparks cleared, camera + speed reset

import type { DownshiftEvent, GridLevel } from "../../../contracts/events.ts";

export const ENGINE = "http://localhost:8000";
export const REPLAY_DATE = "2025-06-24";

// speed = replay seconds per real second (contracts/api.md).
export const SPEEDS: Record<"1" | "2" | "3", number> = {
  "1": 240, // 24 h in 6 min
  "2": 480, // 24 h in 3 min (default)
  "3": 960, // 24 h in 90 s
};
export const DEFAULT_SPEED = SPEEDS["2"];

export type DemoAction =
  | { kind: "replay"; speed: number }
  | { kind: "alert"; level: GridLevel }
  | { kind: "reset" };

export interface DemoContext {
  speed: number;
  level: GridLevel;
}

/** The action for a key press, or null if the key is not a demo key. */
export function actionForKey(key: string, ctx: DemoContext): DemoAction | null {
  const k = key.toLowerCase();
  if (k === "r") return { kind: "replay", speed: ctx.speed };
  if (k === "1" || k === "2" || k === "3") return { kind: "replay", speed: SPEEDS[k] };
  if (k === "a") return { kind: "alert", level: ctx.level === "red" ? "green" : "red" };
  if (k === "x") return { kind: "reset" };
  return null;
}

/** True when the key press belongs to a text field, so demo keys stay out of the way. */
export function isTypingTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The engine request an action makes. Reset sends the grid back to green. */
export function requestFor(action: DemoAction): { path: string; body: object } {
  switch (action.kind) {
    case "replay":
      return { path: "/v1/demo/replay", body: { date: REPLAY_DATE, speed: action.speed } };
    case "alert":
      return { path: "/v1/demo/alert", body: { level: action.level } };
    case "reset":
      return { path: "/v1/demo/alert", body: { level: "green" } };
  }
}

/** Real minutes a full 24 h replay takes at this speed, for the toast. */
export function replayMinutes(speed: number): number {
  return Math.round((86400 / speed / 60) * 10) / 10;
}

/** Short confirmation shown on screen after a key press. */
export function describe(action: DemoAction): string {
  switch (action.kind) {
    case "replay":
      return `Replay started · 24 h in ${replayMinutes(action.speed)} min`;
    case "alert":
      return action.level === "red" ? "Grid Alert sent · red" : "Grid Alert cleared · green";
    case "reset":
      return "Demo reset";
  }
}

// ---- "Simulated" labels ----------------------------------------------------

/** Bit flags for what the current stream contains that is not live data. */
export const SIM_CROWD = 1; // prompts from the simulated crowd
export const SIM_REPLAY = 2; // grid load replayed from June 24, 2025
export const SIM_ESTIMATE = 4; // power estimated, not measured

/** Which simulated-source flag an event carries (0 if it is live). */
export function simulatedFlag(ev: DownshiftEvent): number {
  switch (ev.type) {
    case "prompt.received":
      return ev.source === "crowd" ? SIM_CROWD : 0;
    case "grid.load":
    case "grid.state":
      return ev.source === "replay" ? SIM_REPLAY : 0;
    case "power.sample":
      return ev.source === "estimate" ? SIM_ESTIMATE : 0;
    default:
      return 0;
  }
}

/** Label text for each set flag, in a fixed order. */
export function simulatedLabels(flags: number): string[] {
  const out: string[] = [];
  if (flags & SIM_CROWD) out.push("Simulated crowd");
  if (flags & SIM_REPLAY) out.push("Replayed grid · Jun 24, 2025");
  if (flags & SIM_ESTIMATE) out.push("Estimated power");
  return out;
}

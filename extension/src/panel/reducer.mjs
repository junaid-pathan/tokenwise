// Event reducer — pure logic, no DOM.
// Folds the WS event stream (contracts/events.ts shapes) into the small slice
// of state the panel renders: latest grid level/load and latest narrator line.
// Unknown event types are ignored. Out-of-order events are guarded by ts.

import { GRID_LEVELS } from "./gears.mjs";

export function initialGridState() {
  return {
    connection: "connecting", // "connecting" | "online" | "offline"
    level: null, // "green" | "yellow" | "red" | null (unknown)
    load_mw: null,
    gridTs: 0,
    narrator: null, // latest narrator line text
    narratorTs: 0,
    synthetic: false, // true when events are flagged as test/synthetic data
  };
}

export function reduce(state, event) {
  if (!event || typeof event !== "object") return state;
  switch (event.type) {
    case "grid.state": {
      if (typeof event.ts === "number" && event.ts < state.gridTs) return state;
      if (!(event.level in GRID_LEVELS)) return state;
      return {
        ...state,
        level: event.level,
        load_mw: typeof event.load_mw === "number" ? event.load_mw : state.load_mw,
        gridTs: event.ts || state.gridTs,
        synthetic: event.synthetic === true ? true : state.synthetic,
      };
    }
    case "narrator.line": {
      if (typeof event.ts === "number" && event.ts < state.narratorTs) return state;
      if (typeof event.text !== "string" || event.text === "") return state;
      return {
        ...state,
        narrator: event.text,
        narratorTs: event.ts || state.narratorTs,
        synthetic: event.synthetic === true ? true : state.synthetic,
      };
    }
    default:
      return state;
  }
}

// Fold a batch (the last-50 replay sent on WS connect) in order.
export function reduceAll(state, events) {
  if (!Array.isArray(events)) return state;
  return events.reduce((s, e) => reduce(s, e), state);
}

// Derived view helpers (still DOM-free).
export function levelWord(level) {
  return level && GRID_LEVELS[level] ? GRID_LEVELS[level].word : "Unknown";
}

export function levelColor(level) {
  return level && GRID_LEVELS[level] ? GRID_LEVELS[level].color : "#8b949e";
}

// Banner policy: red → alert, yellow → softer note, else none.
export function bannerFor(level) {
  if (level === "red") return { kind: "alert", text: "Grid Alert \u2014 grid is Red. Shifting down helps." };
  if (level === "yellow") return { kind: "note", text: "Grid is Yellow \u2014 a lighter gear helps." };
  return null;
}

export function formatLoad(load_mw) {
  if (typeof load_mw !== "number") return "\u2014";
  return `${Math.round(load_mw).toLocaleString("en-US")} MW`;
}

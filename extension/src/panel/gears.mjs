// Gear data copied from contracts/gears.json (Phase-0 frozen).
// We copy the strings rather than importing the JSON at runtime (MV3 pages,
// no build step). New users only ever see user_sees + typical_prompt — never
// the words "model" or "tokens".
//
// relative_energy is a documented, dimensionless energy weight used only to
// estimate "Wh saved" ranges when gears.json est_wh_per_1k_out_tokens is null
// (it is null today). It scales roughly with model size / cost per gear and is
// NOT a measured figure. See README "Estimated Wh saved" for the method.

export const GEARS = [
  {
    gear: 1,
    user_sees: "Quick",
    typical_prompt: "a fact, a sum, a one-line rewrite",
    est_wh_per_1k_out_tokens: null,
    relative_energy: 0.02,
    color: "#22c55e",
  },
  {
    gear: 2,
    user_sees: "Light",
    typical_prompt: "short explanation, summarize, extract",
    est_wh_per_1k_out_tokens: null,
    relative_energy: 0.06,
    color: "#84cc16",
  },
  {
    gear: 3,
    user_sees: "Standard",
    typical_prompt: "multi-paragraph writing, simple code",
    est_wh_per_1k_out_tokens: null,
    relative_energy: 0.25,
    color: "#eab308",
  },
  {
    gear: 4,
    user_sees: "Heavy",
    typical_prompt: "multi-step reasoning, real code",
    est_wh_per_1k_out_tokens: null,
    relative_energy: 0.6,
    color: "#f97316",
  },
  {
    gear: 5,
    user_sees: "Max",
    typical_prompt: "hard math, architecture, long constrained writing",
    est_wh_per_1k_out_tokens: null,
    relative_energy: 1.0,
    color: "#ef4444",
  },
];

// The Heavy-gear baseline the "Wh saved" comparison is measured against.
// PRD: "compare the energy of the chosen gear to a Heavy-gear baseline".
export const BASELINE_GEAR = 4;

export const GRID_LEVELS = {
  green: { word: "Green", color: "#22c55e", max_mw: 20000 },
  yellow: { word: "Yellow", color: "#eab308", max_mw: 23500 },
  red: { word: "Red", color: "#ef4444", max_mw: null },
};

export function gearByNumber(n) {
  return GEARS.find((g) => g.gear === n) || null;
}

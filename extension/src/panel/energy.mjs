// Energy / "Wh saved" estimation — pure logic, no DOM.
//
// Method (documented in README "Estimated Wh saved"):
//   We estimate the energy a Heavy-gear (baseline) answer would have used and
//   subtract the chosen gear's estimated energy. Both come from a documented
//   relative-energy table in gears.mjs (dimensionless weights that scale with
//   model size). We convert to Wh using a single documented anchor so the
//   RATIO between gears — not the absolute number — carries the meaning, then
//   present a RANGE of +/-30% and always label it "estimated".
//
//   If gears.json est_wh_per_1k_out_tokens becomes non-null in the future and
//   an output-token count is available, prefer that real figure.
//
// We never invent precision: the output is a rounded low..high range string.

import { gearByNumber, BASELINE_GEAR } from "./gears.mjs";

// Documented anchor: Wh for a full Heavy-gear (baseline) answer of ~500 output
// tokens. Chosen so Quick ~ a few Wh-hundredths and Max ~ baseline/0.6. This is
// an illustrative anchor, not a measurement — hence the +/-30% spread.
export const BASELINE_WH = 3.0;
export const SPREAD = 0.3; // +/-30%

// Estimate Wh for one answer at a given gear using the relative-energy table.
export function estimateWh(gearNum, { outputTokens = null } = {}) {
  const gear = gearByNumber(gearNum);
  if (!gear) return 0;
  // Prefer the real figure if the contract ever fills it in.
  if (gear.est_wh_per_1k_out_tokens != null && outputTokens != null) {
    return (gear.est_wh_per_1k_out_tokens * outputTokens) / 1000;
  }
  const baseline = gearByNumber(BASELINE_GEAR);
  const scale = BASELINE_WH / baseline.relative_energy;
  return gear.relative_energy * scale;
}

// Wh saved vs the Heavy baseline for choosing `gearNum`. Never negative.
export function whSaved(gearNum, opts = {}) {
  const baselineWh = estimateWh(BASELINE_GEAR, opts);
  const chosenWh = estimateWh(gearNum, opts);
  return Math.max(0, baselineWh - chosenWh);
}

// Produce a low..high range with +/-30% spread.
export function whSavedRange(gearNum, opts = {}) {
  const mid = whSaved(gearNum, opts);
  return { low: mid * (1 - SPREAD), high: mid * (1 + SPREAD), mid };
}

export function roundWh(x) {
  if (x >= 10) return Math.round(x);
  if (x >= 1) return Math.round(x * 10) / 10;
  return Math.round(x * 100) / 100;
}

// Human string. Baseline gear (and up) saves ~nothing → say so plainly.
export function formatSavedRange(gearNum, opts = {}) {
  const { low, high } = whSavedRange(gearNum, opts);
  if (high <= 0.005) return "about 0 Wh (estimated)";
  const lo = roundWh(low);
  const hi = roundWh(high);
  if (lo === hi) return `about ${lo} Wh (estimated)`;
  return `about ${lo}\u2013${hi} Wh (estimated)`;
}

// Format a measured/estimated energy figure coming back from the engine.
// energy_j is Joules; 1 Wh = 3600 J.
export function formatAnswerEnergy(energy_j, energy_source) {
  const wh = energy_j / 3600;
  const label = energy_source === "measured" ? "measured" : "estimated";
  return `${roundWh(wh)} Wh (${label})`;
}

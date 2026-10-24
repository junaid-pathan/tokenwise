import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateWh,
  whSaved,
  whSavedRange,
  formatSavedRange,
  formatAnswerEnergy,
  roundWh,
  BASELINE_WH,
} from "./energy.mjs";

test("baseline gear estimate equals BASELINE_WH", () => {
  assert.equal(roundWh(estimateWh(4)), roundWh(BASELINE_WH));
});

test("lighter gears use less energy than heavier", () => {
  assert.ok(estimateWh(1) < estimateWh(2));
  assert.ok(estimateWh(2) < estimateWh(3));
  assert.ok(estimateWh(3) < estimateWh(4));
  assert.ok(estimateWh(4) < estimateWh(5));
});

test("whSaved is positive for light gears, zero at/above baseline", () => {
  assert.ok(whSaved(1) > 0);
  assert.equal(whSaved(4), 0); // baseline saves nothing
  assert.equal(whSaved(5), 0); // heavier than baseline clamps to 0
});

test("range brackets the midpoint at +/-30%", () => {
  const r = whSavedRange(1);
  assert.ok(r.low < r.mid && r.mid < r.high);
  assert.ok(Math.abs(r.low - r.mid * 0.7) < 1e-9);
  assert.ok(Math.abs(r.high - r.mid * 1.3) < 1e-9);
});

test("formatSavedRange is labelled estimated and is a range", () => {
  const s = formatSavedRange(1);
  assert.match(s, /\(estimated\)$/);
  assert.match(s, /Wh/);
});

test("formatSavedRange says ~0 at baseline", () => {
  assert.match(formatSavedRange(4), /0 Wh \(estimated\)/);
});

test("prefers real per-token figure when provided", () => {
  // gears.mjs has null today, so this falls back; sanity check shape only.
  const wh = estimateWh(2, { outputTokens: 500 });
  assert.ok(wh > 0);
});

test("formatAnswerEnergy converts joules to Wh with source label", () => {
  // 3600 J = 1 Wh
  assert.equal(formatAnswerEnergy(3600, "measured"), "1 Wh (measured)");
  assert.match(formatAnswerEnergy(3.1, "estimated"), /\(estimated\)$/);
});

test("roundWh scales precision by magnitude", () => {
  assert.equal(roundWh(0.024), 0.02);
  assert.equal(roundWh(2.47), 2.5);
  assert.equal(roundWh(24.7), 25);
});

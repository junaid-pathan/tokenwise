// Unit tests for the pure scene logic. Run with:
//   npx --yes tsx@4.19.2 --test gridroom/src/scene/logic.test.ts
// Uses node:test + node:assert. No React/three imports here.
import { test } from "node:test";
import assert from "node:assert/strict";

import { lonLatToXZ, STATE_CENTER, PROJECTION_SCALE } from "./projection.ts";
import { nearestTowerIndex, TOWERS } from "./towers.ts";
import { sparkColor, SPARK_AMBER, SPARK_GREEN, levelColor, hexToRgb } from "./colors.ts";
import { arcControlPoint, bezierPoint } from "./arc.ts";
import { EventProcessor, canonicalTown, DEFAULT_TOWN } from "./effects.ts";
import type { DownshiftEvent } from "../../../contracts/events.ts";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const centroids: Record<string, [number, number]> = JSON.parse(
  readFileSync(join(here, "data", "town-centroids.json"), "utf8")
);

// --- projection -----------------------------------------------------------
test("projection: state centre maps to origin", () => {
  const [x, z] = lonLatToXZ(STATE_CENTER[0], STATE_CENTER[1]);
  assert.ok(Math.abs(x) < 1e-9, `x=${x}`);
  assert.ok(Math.abs(z) < 1e-9, `z=${z}`);
});

test("projection: east is +x, north is -z", () => {
  const east = lonLatToXZ(STATE_CENTER[0] + 1, STATE_CENTER[1]);
  const north = lonLatToXZ(STATE_CENTER[0], STATE_CENTER[1] + 1);
  assert.ok(east[0] > 0, "east should be +x");
  assert.ok(north[1] < 0, "north should be -z");
});

test("projection: whole state fits within a sane bound", () => {
  // MA extremes roughly: lon -73.5..-69.9, lat 41.2..42.9
  const corners: [number, number][] = [
    [-73.5, 41.2],
    [-69.9, 42.9],
    [-73.5, 42.9],
    [-69.9, 41.2],
  ];
  for (const [lon, lat] of corners) {
    const [x, z] = lonLatToXZ(lon, lat);
    assert.ok(Math.abs(x) < 30, `x in bound: ${x}`);
    assert.ok(Math.abs(z) < 30, `z in bound: ${z}`);
  }
  assert.equal(PROJECTION_SCALE, 6);
});

// --- nearest tower --------------------------------------------------------
function coords(name: string): [number, number] {
  const c = centroids[name];
  assert.ok(c, `centroid for ${name}`);
  return c;
}
test("nearest tower: Worcester -> Lowell or Westfield/Holyoke region", () => {
  // Worcester is central; nearest of the three western/northern towers.
  const [lon, lat] = coords("Worcester");
  const idx = nearestTowerIndex(lon, lat);
  assert.ok(idx >= 0 && idx < TOWERS.length);
  // Worcester (-71.8,42.27) is closer to Lowell (-71.32,42.63) than to the
  // two western towers near -72.6/-72.75.
  assert.equal(TOWERS[idx].name, "Lowell");
});
test("nearest tower: Springfield -> Holyoke (nearest western tower)", () => {
  // Springfield (-72.54,42.12) sits just south of Holyoke (-72.62,42.20)
  // and is closer to it than to Westfield (-72.75,42.13) or Lowell.
  const [lon, lat] = coords("Springfield");
  const idx = nearestTowerIndex(lon, lat);
  assert.equal(TOWERS[idx].name, "Holyoke");
});
test("nearest tower: Boston -> Lowell", () => {
  const [lon, lat] = coords("Boston");
  const idx = nearestTowerIndex(lon, lat);
  assert.equal(TOWERS[idx].name, "Lowell");
});
test("nearest tower: Pittsfield -> Westfield or Holyoke (western)", () => {
  const [lon, lat] = coords("Pittsfield");
  const idx = nearestTowerIndex(lon, lat);
  assert.notEqual(TOWERS[idx].name, "Lowell");
});

// --- colours --------------------------------------------------------------
test("colour rule: full power is amber", () => {
  assert.equal(sparkColor(3, 3), SPARK_AMBER);
  assert.equal(sparkColor(5, 2), SPARK_AMBER);
});
test("colour rule: downshifted is green", () => {
  assert.equal(sparkColor(1, 3), SPARK_GREEN);
  assert.equal(sparkColor(2, 5), SPARK_GREEN);
});
test("level colours hard-coded", () => {
  assert.equal(levelColor("green"), "#22c55e");
  assert.equal(levelColor("yellow"), "#eab308");
  assert.equal(levelColor("red"), "#ef4444");
});
test("hexToRgb normalises", () => {
  assert.deepEqual(hexToRgb("#ffffff"), [1, 1, 1]);
  assert.deepEqual(hexToRgb("#000000"), [0, 0, 0]);
  const [r] = hexToRgb("#ef4444");
  assert.ok(Math.abs(r - 239 / 255) < 1e-9);
});

// --- bezier ---------------------------------------------------------------
test("bezier endpoints: t=0 is start, t=1 is end", () => {
  const start: [number, number, number] = [0, 0, 0];
  const end: [number, number, number] = [4, 2, -3];
  const ctrl = arcControlPoint(start, end);
  assert.deepEqual(bezierPoint(start, ctrl, end, 0), start);
  assert.deepEqual(bezierPoint(start, ctrl, end, 1), end);
});
test("bezier arches upward at the midpoint", () => {
  const start: [number, number, number] = [0, 0, 0];
  const end: [number, number, number] = [10, 0, 0];
  const ctrl = arcControlPoint(start, end);
  const mid = bezierPoint(start, ctrl, end, 0.5);
  assert.ok(mid[1] > 0, `midpoint y should rise: ${mid[1]}`);
});

// --- event processor ------------------------------------------------------
function ev(e: Partial<DownshiftEvent> & { type: string; id: string }): DownshiftEvent {
  return { ts: 0, ...e } as DownshiftEvent;
}

test("default-town fallback: unknown town uses Boston", () => {
  const p = new EventProcessor(centroids);
  p.process(ev({ type: "prompt.received", id: "a", prompt_id: "p1", source: "extension", chars: 5, town: "Nowhereville" }));
  const eff = p.process(ev({ type: "route.decided", id: "b", prompt_id: "p1", gear_needed: 1, gear_used: 1, model: "m", deferred: false, protected: false, reason: "" }));
  assert.ok(eff && eff.kind === "spark");
  if (eff.kind === "spark") assert.equal(eff.town, DEFAULT_TOWN);
});

test("default-town fallback: missing prompt.received uses Boston", () => {
  const p = new EventProcessor(centroids);
  const eff = p.process(ev({ type: "route.decided", id: "b", prompt_id: "orphan", gear_needed: 1, gear_used: 1, model: "m", deferred: false, protected: false, reason: "" }));
  assert.ok(eff && eff.kind === "spark");
  if (eff.kind === "spark") assert.equal(eff.town, DEFAULT_TOWN);
});

test("case-insensitive town match", () => {
  assert.equal(canonicalTown("worcester", centroids), "Worcester");
  assert.equal(canonicalTown("BOSTON", centroids), "Boston");
  assert.equal(canonicalTown("nope", centroids), null);
});

test("known town resolves to its centroid", () => {
  const p = new EventProcessor(centroids);
  p.process(ev({ type: "prompt.received", id: "a", prompt_id: "p1", source: "crowd", chars: 5, town: "Springfield" }));
  const eff = p.process(ev({ type: "route.decided", id: "b", prompt_id: "p1", gear_needed: 2, gear_used: 2, model: "m", deferred: false, protected: false, reason: "" }));
  assert.ok(eff && eff.kind === "spark");
  if (eff.kind === "spark") {
    assert.equal(eff.town, "Springfield");
    assert.deepEqual([eff.lon, eff.lat], centroids["Springfield"]);
  }
});

test("event dedup: same id processed once", () => {
  const p = new EventProcessor(centroids);
  const e = ev({ type: "grid.state", id: "g1", load_mw: 1, level: "red", replay_clock: "", source: "replay" });
  const first = p.process(e);
  const second = p.process(e);
  assert.ok(first && first.kind === "level");
  assert.equal(second, null);
});

test("deferred route.decided is skipped (no spark)", () => {
  const p = new EventProcessor(centroids);
  p.process(ev({ type: "prompt.received", id: "a", prompt_id: "p1", source: "crowd", chars: 5, town: "Worcester" }));
  const eff = p.process(ev({ type: "route.decided", id: "b", prompt_id: "p1", gear_needed: 3, gear_used: 2, model: "m", deferred: true, protected: false, reason: "" }));
  assert.equal(eff, null);
});

test("power.sample yields a power effect", () => {
  const p = new EventProcessor(centroids);
  const eff = p.process(ev({ type: "power.sample", id: "w1", watts: 72, device: "T4", source: "estimate" }));
  assert.ok(eff && eff.kind === "power");
  if (eff.kind === "power") assert.equal(eff.watts, 72);
});

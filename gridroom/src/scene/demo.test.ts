// Unit tests for the pure B9 demo logic. Run with:
//   npx --yes tsx@4.19.2 --test gridroom/src/scene/demo.test.ts
// Uses node:test + node:assert. No React/three imports here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  actionForKey,
  isTypingTarget,
  requestFor,
  replayMinutes,
  describe,
  simulatedFlag,
  simulatedLabels,
  SPEEDS,
  DEFAULT_SPEED,
  REPLAY_DATE,
  SIM_CROWD,
  SIM_REPLAY,
  SIM_ESTIMATE,
} from "./demo.ts";
import type { DownshiftEvent } from "../../../contracts/events.ts";

const ctx = { speed: DEFAULT_SPEED, level: "green" as const };
const ev = (o: Record<string, unknown>) => ({ id: "x", ts: 0, ...o }) as unknown as DownshiftEvent;

test("R replays at the current speed, case-insensitive", () => {
  assert.deepEqual(actionForKey("r", { ...ctx, speed: 960 }), { kind: "replay", speed: 960 });
  assert.deepEqual(actionForKey("R", ctx), { kind: "replay", speed: DEFAULT_SPEED });
});

test("1-3 replay at slow / normal / fast", () => {
  assert.deepEqual(actionForKey("1", ctx), { kind: "replay", speed: SPEEDS["1"] });
  assert.deepEqual(actionForKey("2", ctx), { kind: "replay", speed: 480 });
  assert.deepEqual(actionForKey("3", ctx), { kind: "replay", speed: SPEEDS["3"] });
  assert.ok(SPEEDS["1"] < SPEEDS["2"] && SPEEDS["2"] < SPEEDS["3"]);
});

test("A toggles the alert between red and green", () => {
  assert.deepEqual(actionForKey("a", ctx), { kind: "alert", level: "red" });
  assert.deepEqual(actionForKey("a", { ...ctx, level: "yellow" }), { kind: "alert", level: "red" });
  assert.deepEqual(actionForKey("a", { ...ctx, level: "red" }), { kind: "alert", level: "green" });
});

test("X resets; other keys are ignored", () => {
  assert.deepEqual(actionForKey("x", ctx), { kind: "reset" });
  for (const k of ["q", "4", " ", "Enter", "Escape"]) assert.equal(actionForKey(k, ctx), null);
});

test("typing targets swallow demo keys", () => {
  assert.equal(isTypingTarget({ tagName: "input" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BODY" }), false);
  assert.equal(isTypingTarget(null), false);
});

test("requests match contracts/api.md", () => {
  assert.deepEqual(requestFor({ kind: "replay", speed: 480 }), {
    path: "/v1/demo/replay",
    body: { date: REPLAY_DATE, speed: 480 },
  });
  assert.deepEqual(requestFor({ kind: "alert", level: "red" }), {
    path: "/v1/demo/alert",
    body: { level: "red" },
  });
  assert.deepEqual(requestFor({ kind: "reset" }), {
    path: "/v1/demo/alert",
    body: { level: "green" },
  });
});

test("replay minutes and toast text", () => {
  assert.equal(replayMinutes(480), 3);
  assert.equal(replayMinutes(960), 1.5);
  assert.equal(describe({ kind: "replay", speed: 480 }), "Replay started · 24 h in 3 min");
  assert.ok(/red/.test(describe({ kind: "alert", level: "red" })));
});

test("simulated flags per source", () => {
  assert.equal(simulatedFlag(ev({ type: "prompt.received", source: "crowd" })), SIM_CROWD);
  assert.equal(simulatedFlag(ev({ type: "prompt.received", source: "extension" })), 0);
  assert.equal(simulatedFlag(ev({ type: "grid.state", source: "replay" })), SIM_REPLAY);
  assert.equal(simulatedFlag(ev({ type: "grid.load", source: "live" })), 0);
  assert.equal(simulatedFlag(ev({ type: "power.sample", source: "estimate" })), SIM_ESTIMATE);
  assert.equal(simulatedFlag(ev({ type: "power.sample", source: "cloud" })), 0);
  assert.equal(simulatedFlag(ev({ type: "route.decided" })), 0);
});

test("simulated labels in fixed order", () => {
  assert.deepEqual(simulatedLabels(0), []);
  assert.deepEqual(simulatedLabels(SIM_ESTIMATE | SIM_CROWD), ["Simulated crowd", "Estimated power"]);
  assert.equal(simulatedLabels(SIM_CROWD | SIM_REPLAY | SIM_ESTIMATE).length, 3);
});

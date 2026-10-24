// Unit tests for the pure world logic. Run with:
//   npx --yes tsx@4.19.2 --test gridroom/src/scene/world/world.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildWorld, homeIndexFor, isRiver, WIDTH, DEPTH } from "./terrain.ts";
import {
  WorldProcessor,
  clockMinutes,
  energySavedPct,
  formatClock,
  isYouPrompt,
  siteFor,
  SPARK_AMBER,
  SPARK_GREEN,
} from "./worldState.ts";
import type { DownshiftEvent } from "../../../../contracts/events.ts";

let n = 0;
const ev = (o: Record<string, unknown>) => ({ id: `e${n++}`, ts: 0, ...o }) as unknown as DownshiftEvent;
const route = (pid: string, needed: number, used: number, extra: Record<string, unknown> = {}) =>
  ev({ type: "route.decided", prompt_id: pid, gear_needed: needed, gear_used: used, model: "m",
       deferred: false, protected: false, reason: "", ...extra });

test("world is deterministic and has its landmarks", () => {
  const a = buildWorld(7);
  const b = buildWorld(7);
  assert.equal(a.blocks.length, b.blocks.length);
  assert.ok(a.blocks.length > 3000);
  assert.ok(a.homes.length >= 12);
  assert.ok(a.you[1] > 3, "you house sits above ground");
  assert.ok(a.dataCenter[1] > a.you[1], "data center roof is higher than homes");
  assert.ok(a.blocks.some((x) => x.t === "water"));
  assert.ok(a.blocks.some((x) => x.t === "you"));
  assert.ok(a.blocks.every((x) => x.x >= 0 && x.x < WIDTH && x.z >= 0 && x.z < DEPTH));
});

test("river runs through the east side", () => {
  const rowsWithRiver = Array.from({ length: DEPTH }, (_, z) => z).filter((z) =>
    Array.from({ length: WIDTH }, (_, x) => x).some((x) => isRiver(x, z))
  );
  assert.equal(rowsWithRiver.length, DEPTH);
});

test("home index is stable and in range", () => {
  assert.equal(homeIndexFor("p-1", 18), homeIndexFor("p-1", 18));
  for (const id of ["a", "b", "crowd-123", "x-9"]) {
    const i = homeIndexFor(id, 18);
    assert.ok(i >= 0 && i < 18);
  }
});

test("your prompts are recognised even when route arrives first", () => {
  assert.equal(isYouPrompt("claude-1a2b3c4d", undefined), true);
  assert.equal(isYouPrompt("ext-1a2b3c4d", undefined), true);
  assert.equal(isYouPrompt("c-77", "crowd"), false);
  assert.equal(isYouPrompt("anything", "extension"), true);
  assert.equal(siteFor("claude-1"), "Claude");
  assert.equal(siteFor("ext-1"), "Downshift panel");

  const p = new WorldProcessor(18, () => 1000);
  const orb = p.process(route("claude-abc", 3, 2));
  assert.ok(orb && orb.you && orb.home === -1);
  assert.equal(orb!.color, SPARK_GREEN);
  const s = p.snapshot();
  assert.equal(s.youCount, 1);
  assert.equal(s.lastYou?.site, "Claude");
  assert.equal(s.decisions[0].tone, "you");
});

test("crowd routes fly amber/green from a home; deferred never fly", () => {
  const p = new WorldProcessor(18);
  p.process(ev({ type: "prompt.received", prompt_id: "c1", source: "crowd", chars: 9 }));
  const full = p.process(route("c1", 2, 2));
  assert.equal(full!.color, SPARK_AMBER);
  assert.equal(full!.you, false);
  assert.ok(full!.home >= 0);
  assert.equal(p.process(route("c2", 3, 3, { deferred: true })), null);
  const s = p.snapshot();
  assert.equal(s.routed, 2);
  assert.equal(s.deferred, 1);
});

test("events are processed once; repeated decisions collapse", () => {
  const p = new WorldProcessor(18);
  const r = ev({ type: "coordinator.report", request_id: "q", achieved_cut_pct: 0, joules_baseline: 1, joules_actual: 1 });
  p.process(r);
  p.process(r); // same id: ignored
  p.process(ev({ type: "coordinator.report", request_id: "q", achieved_cut_pct: 0, joules_baseline: 1, joules_actual: 1 }));
  const d = p.snapshot().decisions;
  assert.equal(d.length, 1);
  assert.equal(d[0].count, 2);
});

test("grid level changes are logged, the first one is not", () => {
  const p = new WorldProcessor(18);
  p.process(ev({ type: "grid.state", level: "green", load_mw: 15000, replay_clock: "2025-06-24T03:00:00", source: "replay" }));
  p.process(ev({ type: "grid.state", level: "red", load_mw: 25500, replay_clock: "2025-06-24T17:00:00", source: "replay" }));
  const s = p.snapshot();
  assert.equal(s.level, "red");
  assert.equal(s.decisions.length, 1);
  assert.equal(s.decisions[0].tone, "warn");
});

test("clock and energy helpers", () => {
  assert.equal(clockMinutes("2025-06-24T15:05:00"), 905);
  assert.equal(clockMinutes(""), null);
  assert.equal(formatClock(905), "3:05 pm");
  assert.equal(formatClock(0), "12:00 am");
  assert.equal(formatClock(null), "--:--");
  const side = (j: number) => ({ j_per_answer: j, quality_match_pct: 94, p50_latency_ms: 500 });
  assert.equal(energySavedPct({ no_downshift: side(100), downshift: side(72) } as never), 28);
  assert.equal(energySavedPct(null), null);
});

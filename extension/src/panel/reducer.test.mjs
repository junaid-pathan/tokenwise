import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialGridState,
  reduce,
  reduceAll,
  levelWord,
  levelColor,
  bannerFor,
  formatLoad,
} from "./reducer.mjs";

test("grid.state updates level and load", () => {
  const s = reduce(initialGridState(), {
    type: "grid.state",
    ts: 100,
    level: "red",
    load_mw: 24180,
  });
  assert.equal(s.level, "red");
  assert.equal(s.load_mw, 24180);
});

test("out-of-order grid.state is ignored", () => {
  let s = reduce(initialGridState(), { type: "grid.state", ts: 200, level: "red", load_mw: 24000 });
  s = reduce(s, { type: "grid.state", ts: 100, level: "green", load_mw: 15000 });
  assert.equal(s.level, "red");
});

test("invalid level is ignored", () => {
  const s = reduce(initialGridState(), { type: "grid.state", ts: 1, level: "purple", load_mw: 1 });
  assert.equal(s.level, null);
});

test("narrator.line updates text", () => {
  const s = reduce(initialGridState(), { type: "narrator.line", ts: 5, text: "Hello grid" });
  assert.equal(s.narrator, "Hello grid");
});

test("empty narrator text is ignored", () => {
  const s = reduce(initialGridState(), { type: "narrator.line", ts: 5, text: "" });
  assert.equal(s.narrator, null);
});

test("synthetic flag sticks", () => {
  const s = reduce(initialGridState(), {
    type: "grid.state", ts: 1, level: "green", load_mw: 1, synthetic: true,
  });
  assert.equal(s.synthetic, true);
});

test("unknown events pass through unchanged", () => {
  const base = initialGridState();
  assert.equal(reduce(base, { type: "power.sample", ts: 1, watts: 100 }), base);
  assert.equal(reduce(base, null), base);
});

test("reduceAll folds a batch in order", () => {
  const s = reduceAll(initialGridState(), [
    { type: "grid.state", ts: 1, level: "green", load_mw: 15000 },
    { type: "grid.state", ts: 2, level: "yellow", load_mw: 22000 },
    { type: "narrator.line", ts: 3, text: "Shifting down" },
  ]);
  assert.equal(s.level, "yellow");
  assert.equal(s.narrator, "Shifting down");
});

test("level helpers never rely on colour alone", () => {
  assert.equal(levelWord("red"), "Red");
  assert.equal(levelWord(null), "Unknown");
  assert.equal(levelColor("green"), "#22c55e");
});

test("banner policy: red alert, yellow note, green none", () => {
  assert.equal(bannerFor("red").kind, "alert");
  assert.equal(bannerFor("yellow").kind, "note");
  assert.equal(bannerFor("green"), null);
});

test("formatLoad adds thousands separators and MW", () => {
  assert.equal(formatLoad(24180), "24,180 MW");
  assert.equal(formatLoad(null), "\u2014");
});

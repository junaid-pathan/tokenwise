import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createShifter,
  POSITIONS,
  positionToMode,
  modeToPosition,
  isValid,
} from "./shifter.mjs";

test("default position is auto", () => {
  const s = createShifter();
  assert.equal(s.position(), "auto");
  assert.equal(s.mode(), "auto");
});

test("invalid initial falls back to auto", () => {
  const s = createShifter(9);
  assert.equal(s.position(), "auto");
});

test("set accepts valid positions and rejects invalid", () => {
  const s = createShifter();
  assert.equal(s.set(3), 3);
  assert.equal(s.mode(), "gear 3");
  assert.equal(s.set(99), 3); // unchanged
});

test("next/prev wrap around the ordered list", () => {
  const s = createShifter("auto");
  assert.equal(s.next(), 1);
  assert.equal(s.next(), 2);
  s.set(5);
  assert.equal(s.next(), "auto"); // wrap forward
  assert.equal(s.prev(), 5); // wrap backward
});

test("home/end jump to ends", () => {
  const s = createShifter(3);
  assert.equal(s.home(), "auto");
  assert.equal(s.end(), 5);
});

test("positionToMode maps correctly", () => {
  assert.equal(positionToMode("auto"), "auto");
  assert.equal(positionToMode(4), "gear 4");
});

test("modeToPosition parses many forms", () => {
  assert.equal(modeToPosition("auto"), "auto");
  assert.equal(modeToPosition(null), "auto");
  assert.equal(modeToPosition(3), 3);
  assert.equal(modeToPosition("gear 2"), 2);
  assert.equal(modeToPosition("gear5"), 5);
  assert.equal(modeToPosition("4"), 4);
  assert.equal(modeToPosition("Standard"), 3);
  assert.equal(modeToPosition("Max"), 5);
  assert.equal(modeToPosition("nonsense"), "auto");
  assert.equal(modeToPosition(9), "auto");
});

test("isValid and POSITIONS", () => {
  assert.ok(isValid("auto"));
  assert.ok(isValid(1));
  assert.ok(!isValid(0));
  assert.deepEqual(POSITIONS, ["auto", 1, 2, 3, 4, 5]);
});

test("modeToPosition accepts pickaxe tier names", () => {
  assert.equal(modeToPosition("Wooden"), 1);
  assert.equal(modeToPosition("iron"), 3);
  assert.equal(modeToPosition("Netherite"), 5);
});

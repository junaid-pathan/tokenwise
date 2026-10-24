import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackoff } from "./backoff.mjs";
import { parseHandoff, isOpenMessage, PENDING_KEY } from "./handoff.mjs";
import {
  resolveBase,
  normaliseBase,
  wsUrlFor,
  answerUrlFor,
  readQueryApi,
  DEFAULT_BASE,
} from "./config.mjs";

test("backoff grows exponentially and caps", () => {
  const b = createBackoff({ base: 500, max: 15000, factor: 2 });
  assert.equal(b.delayFor(0), 500);
  assert.equal(b.delayFor(1), 1000);
  assert.equal(b.delayFor(2), 2000);
  assert.equal(b.delayFor(10), 15000); // capped
});

test("backoff next advances attempt and reset clears it", () => {
  const b = createBackoff();
  assert.equal(b.attempt(), 0);
  b.next();
  assert.equal(b.attempt(), 1);
  b.reset();
  assert.equal(b.attempt(), 0);
});

test("backoff next stays within jitter bounds", () => {
  const b = createBackoff({ base: 1000, factor: 1, jitter: 0.25 });
  for (let i = 0; i < 50; i++) {
    const d = createBackoff({ base: 1000, factor: 1, jitter: 0.25 }).next();
    assert.ok(d >= 750 && d <= 1250, `delay ${d} out of bounds`);
  }
  assert.ok(b);
});

test("parseHandoff normalises storage payload", () => {
  const h = parseHandoff({ prompt: "  hello  ", gear_suggested: 3, ts: 1 });
  assert.deepEqual(h, { prompt: "hello", position: 3 });
});

test("parseHandoff normalises runtime message", () => {
  const h = parseHandoff({ type: "downshift.open", prompt: "hi", gear_suggested: "gear 2" });
  assert.deepEqual(h, { prompt: "hi", position: 2 });
});

test("parseHandoff rejects wrong type, empty prompt, junk", () => {
  assert.equal(parseHandoff({ type: "other", prompt: "x" }), null);
  assert.equal(parseHandoff({ prompt: "   " }), null);
  assert.equal(parseHandoff(null), null);
});

test("parseHandoff defaults unknown gear to auto", () => {
  assert.equal(parseHandoff({ prompt: "x" }).position, "auto");
});

test("isOpenMessage and PENDING_KEY", () => {
  assert.ok(isOpenMessage({ type: "downshift.open", prompt: "x" }));
  assert.ok(!isOpenMessage({ type: "nope" }));
  assert.equal(PENDING_KEY, "downshift_pending");
});

test("resolveBase precedence: query > stored > default", () => {
  assert.equal(resolveBase({ queryApi: "http://localhost:8010" }), "http://localhost:8010");
  assert.equal(resolveBase({ storedApi: "http://host:9000" }), "http://host:9000");
  assert.equal(resolveBase({}), DEFAULT_BASE);
  assert.equal(resolveBase({ queryApi: "http://a:1", storedApi: "http://b:2" }), "http://a:1");
});

test("normaliseBase strips trailing slashes", () => {
  assert.equal(normaliseBase("http://localhost:8000/"), "http://localhost:8000");
  assert.equal(normaliseBase(""), DEFAULT_BASE);
});

test("wsUrlFor converts scheme and appends stream path", () => {
  assert.equal(wsUrlFor("http://localhost:8010"), "ws://localhost:8010/v1/stream");
  assert.equal(wsUrlFor("https://x.y"), "wss://x.y/v1/stream");
});

test("answerUrlFor builds endpoint", () => {
  assert.equal(answerUrlFor("http://localhost:8010"), "http://localhost:8010/v1/answer");
});

test("readQueryApi extracts api param", () => {
  assert.equal(readQueryApi("?api=http://localhost:8010"), "http://localhost:8010");
  assert.equal(readQueryApi("?foo=1"), null);
  assert.equal(readQueryApi(""), null);
});

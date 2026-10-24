// Reconnect backoff — pure logic, no DOM.
// Exponential backoff with jitter, capped. Reset on a successful connection.

export function createBackoff({ base = 500, max = 15000, factor = 2, jitter = 0.25 } = {}) {
  let attempt = 0;
  return {
    attempt: () => attempt,
    reset() {
      attempt = 0;
    },
    // Return the delay (ms) to wait before the NEXT attempt, then advance.
    next() {
      const raw = Math.min(max, base * Math.pow(factor, attempt));
      attempt += 1;
      const spread = raw * jitter;
      const delta = (Math.random() * 2 - 1) * spread;
      return Math.max(0, Math.round(raw + delta));
    },
    // Deterministic delay for a given attempt (used by tests — no jitter).
    delayFor(n) {
      return Math.min(max, base * Math.pow(factor, n));
    },
  };
}

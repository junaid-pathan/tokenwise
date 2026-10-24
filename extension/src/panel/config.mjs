// Config / base-URL resolution — pure logic, no DOM.
// Precedence for the engine base URL:
//   1. ?api= query param (used for testing, e.g. ?api=http://localhost:8010)
//   2. chrome.storage.local key "downshift_api" (passed in by the caller)
//   3. default http://localhost:8000
// The WS URL is derived from the base (http->ws, https->wss) + /v1/stream.

export const DEFAULT_BASE = "http://localhost:8000";

export function resolveBase({ queryApi = null, storedApi = null } = {}) {
  const candidate = firstNonEmpty(queryApi, storedApi, DEFAULT_BASE);
  return normaliseBase(candidate);
}

export function normaliseBase(url) {
  let u = String(url || "").trim();
  if (u === "") return DEFAULT_BASE;
  u = u.replace(/\/+$/, ""); // strip trailing slashes
  return u;
}

export function wsUrlFor(base) {
  const b = normaliseBase(base);
  const ws = b.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${ws}/v1/stream`;
}

export function answerUrlFor(base) {
  return `${normaliseBase(base)}/v1/answer`;
}

// Read ?api= from a query string or URLSearchParams-like object.
export function readQueryApi(search) {
  if (!search) return null;
  try {
    const params = typeof search === "string" ? new URLSearchParams(search) : search;
    const v = params.get ? params.get("api") : null;
    return v && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

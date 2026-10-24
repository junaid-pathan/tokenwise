// Service worker: proxies the content script's engine calls. Fetching from the
// extension origin avoids claude.ai's CORS and private-network restrictions on
// calling localhost from a public page.

const ENGINE = "http://localhost:8000";
const TIMEOUT_MS = 2500;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "ds.triage") return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  fetch(`${ENGINE}/v1/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: msg.prompt }),
    signal: ctrl.signal,
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`triage ${r.status}`))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }))
    .finally(() => clearTimeout(timer));
  return true; // async sendResponse
});

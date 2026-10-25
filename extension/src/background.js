// Service worker: proxies the content script's engine calls. Fetching from the
// extension origin avoids claude.ai's CORS and private-network restrictions on
// calling localhost from a public page.

const ENGINE = "http://localhost:8000";
// Triage must feel instant; answers come from the Colab models and can be slow.
const ROUTES = {
  "ds.triage": { path: "/v1/triage", timeout: 2500 },
  "ds.answer": { path: "/v1/answer", timeout: 60000 },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const route = msg && ROUTES[msg.type];
  if (!route) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), route.timeout);
  fetch(`${ENGINE}${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.body || { prompt: msg.prompt }),
    signal: ctrl.signal,
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${route.path} ${r.status}`))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }))
    .finally(() => clearTimeout(timer));
  return true; // async sendResponse
});

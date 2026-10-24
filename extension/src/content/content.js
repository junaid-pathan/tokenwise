// A (PR A9): content script on chatgpt.com and claude.ai.
// Reads the composer, debounce-calls /v1/triage, and shows a gear badge so the
// user sees which "gear" their prompt needs before sending.

(() => {
  "use strict";

  const ENGINE = "http://localhost:8000";
  const GEAR_COLORS = {
    1: "#22c55e",
    2: "#84cc16",
    3: "#eab308",
    4: "#f97316",
    5: "#ef4444",
  };
  const DEBOUNCE_MS = 400;
  let lastGear = null; // most recent triage result, handed to the panel on click

  // Composer selectors for the supported sites (first match wins).
  const COMPOSER_SELECTORS = [
    "#prompt-textarea", // chatgpt.com
    'div[contenteditable="true"].ProseMirror', // claude.ai
    'textarea[data-testid="prompt-textarea"]',
    "form textarea",
  ];

  function findComposer() {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function composerText(el) {
    if (!el) return "";
    return (el.value ?? el.innerText ?? "").trim();
  }

  async function triage(prompt) {
    const resp = await fetch(`${ENGINE}/v1/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!resp.ok) throw new Error(`triage ${resp.status}`);
    return resp.json(); // { gear, confidence, label, reason }
  }

  function ensureBadge() {
    let badge = document.getElementById("downshift-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "downshift-badge";
      Object.assign(badge.style, {
        position: "fixed",
        bottom: "90px",
        right: "24px",
        zIndex: "2147483647",
        font: "600 12px system-ui, sans-serif",
        color: "#06090d",
        padding: "6px 10px",
        borderRadius: "999px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        pointerEvents: "auto",
        cursor: "pointer",
        transition: "opacity 0.2s, background 0.2s",
        opacity: "0",
      });
      badge.addEventListener("click", () => {
        const el = findComposer();
        const prompt = composerText(el);
        if (prompt.length >= 3) {
          handOff(prompt, lastGear);
          askEngine(prompt);
        }
      });
      document.body.appendChild(badge);
    }
    return badge;
  }

  function showGear(r) {
    const badge = ensureBadge();
    badge.textContent = `Gear ${r.gear} · ${r.label} — open panel`;
    badge.style.background = GEAR_COLORS[r.gear] || "#8b949e";
    badge.title = r.reason || "";
    badge.style.opacity = "1";
    lastGear = r;
  }

  // Hand the current prompt + suggested gear to B's side panel. Matches the
  // contract in extension/src/panel/handoff.mjs: a storage key the panel reads
  // on open, plus a runtime message if the panel is already open. The panel's
  // Ask button then calls /v1/answer, which routes it (prompt.received ->
  // Triage -> Coordinator -> route.decided) and sparks the Grid Room.
  function handOff(prompt, r) {
    const payload = { prompt, gear_suggested: r ? r.label : undefined, ts: Date.now() };
    try {
      chrome.storage?.local?.set({ downshift_pending: payload });
    } catch (e) {
      /* storage may be unavailable in some contexts */
    }
    try {
      chrome.runtime?.sendMessage({ type: "downshift.open", ...payload });
    } catch (e) {
      /* no receiver (panel closed) is fine — storage carries it on next open */
    }
  }

  // The panel is a toolbar popup that a page cannot open, so the badge answers
  // in place: /v1/answer routes the prompt (Triage -> Coordinator, one gear
  // down on a red grid), generates at that gear and reports the energy used.
  function ensureCard() {
    let card = document.getElementById("downshift-card");
    if (!card) {
      card = document.createElement("div");
      card.id = "downshift-card";
      card.setAttribute("role", "status");
      Object.assign(card.style, {
        position: "fixed",
        bottom: "130px",
        right: "24px",
        width: "340px",
        maxHeight: "50vh",
        overflowY: "auto",
        zIndex: "2147483647",
        font: "13px/1.45 system-ui, sans-serif",
        color: "#e6edf3",
        background: "rgba(13,17,23,0.94)",
        border: "1px solid #30363d",
        borderRadius: "12px",
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        whiteSpace: "pre-wrap",
      });
      const close = document.createElement("button");
      close.textContent = "×";
      close.setAttribute("aria-label", "Close Downshift answer");
      Object.assign(close.style, {
        position: "absolute", top: "4px", right: "8px", background: "none",
        border: "none", color: "#8b949e", fontSize: "18px", cursor: "pointer",
      });
      close.addEventListener("click", () => (card.style.display = "none"));
      card.appendChild(close);
      const body = document.createElement("div");
      body.id = "downshift-card-body";
      card.appendChild(body);
      document.body.appendChild(card);
    }
    card.style.display = "block";
    return card.querySelector("#downshift-card-body");
  }

  async function askEngine(prompt) {
    const body = ensureCard();
    body.textContent = "Asking a smaller model…";
    try {
      const resp = await fetch(`${ENGINE}/v1/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: "auto", source: "extension" }),
      });
      if (!resp.ok) throw new Error(`answer ${resp.status}`);
      const r = await resp.json();
      const energy = r.energy_j != null
        ? ` · ${Number(r.energy_j).toFixed(1)} J ${r.energy_source || ""}`
        : "";
      body.textContent = `Gear ${r.gear_used} · ${r.latency_ms} ms${energy}

${r.text}`;
    } catch (e) {
      body.textContent = "Couldn't reach the Downshift engine on localhost:8000. Is it running?";
    }
  }

  let timer = null;
  function onInput(el) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const prompt = composerText(el);
      if (prompt.length < 3) {
        const badge = document.getElementById("downshift-badge");
        if (badge) badge.style.opacity = "0";
        return;
      }
      try {
        const r = await triage(prompt);
        showGear(r);
        console.log(`[downshift] gear ${r.gear} (${r.label}) · ${r.reason}`);
      } catch (e) {
        // engine offline is fine — stay silent, the panel shows connection state
      }
    }, DEBOUNCE_MS);
  }

  function attach() {
    const el = findComposer();
    if (!el || el.dataset.downshiftBound) return;
    el.dataset.downshiftBound = "1";
    el.addEventListener("input", () => onInput(el));
    console.log("[downshift] content script bound to composer");
  }

  // SPAs swap the composer in and out; re-attach on DOM changes.
  const mo = new MutationObserver(() => attach());
  mo.observe(document.body, { childList: true, subtree: true });
  attach();
})();

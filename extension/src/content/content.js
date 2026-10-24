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
        pointerEvents: "none",
        transition: "opacity 0.2s, background 0.2s",
        opacity: "0",
      });
      document.body.appendChild(badge);
    }
    return badge;
  }

  function showGear(r) {
    const badge = ensureBadge();
    badge.textContent = `Gear ${r.gear} · ${r.label}`;
    badge.style.background = GEAR_COLORS[r.gear] || "#8b949e";
    badge.title = r.reason || "";
    badge.style.opacity = "1";
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

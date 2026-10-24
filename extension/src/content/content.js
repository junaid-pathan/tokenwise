// A (PR A9): content script on chatgpt.com and claude.ai.
// Reads the composer, debounce-calls /v1/triage, and shows a gear badge so the
// user sees which "gear" their prompt needs before sending.
// On claude.ai only, a prompt the user really sends is also announced to the
// engine (/v1/triage with observe: true) so the real Triage + Coordinator route
// it and the Grid Room sparks it. No second answer is generated.

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
  const IS_CLAUDE = location.hostname === "claude.ai";
  const SEND_DEDUPE_MS = 1500;
  const ROUTED_BADGE_MS = 4000;

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

  // Announce a prompt the user really sent; returns { gear, route, prompt_id }.
  async function observe(prompt) {
    const promptId = "claude-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const resp = await fetch(`${ENGINE}/v1/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, observe: true, prompt_id: promptId }),
    });
    if (!resp.ok) throw new Error(`observe ${resp.status}`);
    return resp.json();
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

  // While the "Routed" badge is up, the composer clearing after a send must not
  // hide it.
  let routedUntil = 0;
  let routedTimer = null;

  function showRouted(r) {
    const route = r.route;
    if (!route) return showGear(r);
    const badge = ensureBadge();
    badge.textContent =
      route.gear_used < route.gear_needed
        ? `Routed · Gear ${route.gear_needed} → ${route.gear_used}`
        : `Gear ${route.gear_used} · full power`;
    badge.style.background = GEAR_COLORS[route.gear_used] || "#8b949e";
    badge.title = r.reason || "";
    badge.style.opacity = "1";
    routedUntil = Date.now() + ROUTED_BADGE_MS;
    clearTimeout(routedTimer);
    routedTimer = setTimeout(() => {
      badge.style.opacity = "0";
    }, ROUTED_BADGE_MS);
  }

  let lastSent = { text: "", at: 0 };
  async function onSend(text) {
    const prompt = (text || "").trim();
    if (prompt.length < 3) return;
    const now = Date.now();
    if (prompt === lastSent.text && now - lastSent.at < SEND_DEDUPE_MS) return;
    lastSent = { text: prompt, at: now };
    try {
      const r = await observe(prompt);
      showRouted(r);
      console.log(`[downshift] sent ${r.prompt_id} · gear ${r.gear}`, r.route);
    } catch (e) {
      // engine offline is fine — stay silent
    }
  }

  let timer = null;
  function onInput(el) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const prompt = composerText(el);
      if (prompt.length < 3) {
        const badge = document.getElementById("downshift-badge");
        if (badge && Date.now() >= routedUntil) badge.style.opacity = "0";
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

  // claude.ai only: catch a real send in the capture phase, so the composer text
  // is read before the site clears it. Enter (no Shift, not mid-IME) in the
  // composer, or a click on the Send button.
  if (IS_CLAUDE) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const el = findComposer();
        if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
        onSend(composerText(el));
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target instanceof Element && e.target.closest('button[aria-label*="Send"]');
        if (!btn || btn.disabled) return;
        onSend(composerText(findComposer()));
      },
      true
    );
  }

  // SPAs swap the composer in and out; re-attach on DOM changes.
  const mo = new MutationObserver(() => attach());
  mo.observe(document.body, { childList: true, subtree: true });
  attach();
})();

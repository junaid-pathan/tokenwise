// A: TokenWise sidebar on claude.ai.
// Opens on every new chat. While you type it shows the prompt's gear, the Claude
// model that fits it, and the energy you'd save by switching. Each sent prompt
// is added to a per-user footprint (chrome.storage.local) shown at the top as
// energy (as lightbulb time) and CO2 saved. Model energy figures are estimates (estimates.js).

(() => {
  "use strict";

  const DS = globalThis.DS;
  const DEBOUNCE_MS = 350;
  const STATS_KEY = "ds_stats";
  const DEFAULT_MODEL = "Sonnet"; // claude.ai default when the picker can't be read

  // --- page reading -----------------------------------------------------------
  const COMPOSER_SELECTORS = [
    'div[contenteditable="true"].ProseMirror',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  function findComposer() {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function composerText(el) {
    return el ? (el.innerText || "").trim() : "";
  }

  // Best effort: claude.ai's model picker button names the family.
  function detectModel() {
    const picks = [
      document.querySelector('[data-testid="model-selector-dropdown"]'),
      ...document.querySelectorAll("fieldset button, form button"),
    ];
    for (const b of picks) {
      const m = b && (b.textContent || "").match(/\b(Opus|Sonnet|Haiku)\b/i);
      if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    }
    return null;
  }

  const isNewChat = () => location.pathname === "/new" || location.pathname === "/";

  // --- stats ------------------------------------------------------------------
  let stats = { prompts: 0, right_sized: 0, wh_used: 0, wh_saved: 0, local: 0 };

  function loadStats() {
    try {
      chrome.storage.local.get(STATS_KEY, (v) => {
        if (v && v[STATS_KEY]) stats = { ...stats, ...v[STATS_KEY] };
        renderImpact();
      });
    } catch (e) {
      renderImpact();
    }
  }

  function saveStats() {
    try {
      chrome.storage.local.set({ [STATS_KEY]: stats });
    } catch (e) {
      /* extension reloaded under the page; keep in-memory stats */
    }
  }

  // --- triage -----------------------------------------------------------------
  let engineLive = false;

  function triage(prompt) {
    const pin = DS.demoPin(prompt);
    if (pin) return Promise.resolve({ ...pin, source: engineLive ? "engine" : "rules" });
    return new Promise((resolve) => {
      const fallback = () => {
        engineLive = false;
        resolve({ ...DS.rulesTriage(prompt), source: "rules" });
      };
      try {
        chrome.runtime.sendMessage({ type: "ds.triage", prompt }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return fallback();
          engineLive = true;
          const d = resp.data;
          // Same arbitration as training/model/classifier.py, so an engine on
          // older code still can't call a debug or proof prompt "Light".
          const r = DS.rulesTriage(prompt);
          const words = prompt.split(/\s+/).length;
          if (r.confidence >= 0.8 && (r.gear >= 3 || (words <= 10 && r.confidence > d.confidence))) {
            return resolve({ ...r, source: "engine" });
          }
          resolve({ gear: d.gear, confidence: d.confidence, reason: d.reason, source: "engine" });
        });
      } catch (e) {
        fallback();
      }
    });
  }

  // --- sidebar UI (shadow DOM so claude.ai's CSS can't leak in) ----------------
  // Block-game theme to match B's popup panel (extension/src/panel/panel.css):
  // dirt background, bevelled stone GUI panels, pickaxe hotbar for the gears.
  const CSS = `
    @import url("https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Silkscreen:wght@400;700&display=swap");
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel, .tab {
      --ink: #262626; --muted: #404040; --gui: #c6c6c6; --gui-hi: #fff; --gui-lo: #555;
      --slot: #8b8b8b; --slot-hi: #b4b4b4; --slot-lo: #373737; --chat: rgba(0,0,0,0.62);
      --emerald: #17a34a;
      --pixel: "Pixelify Sans", "Segoe UI", system-ui, sans-serif;
      --caps: "Silkscreen", "Pixelify Sans", ui-monospace, monospace;
      font-family: var(--pixel); line-height: 1.35;
    }
    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: 340px; z-index: 2147483647;
      color: var(--ink); padding: 12px; overflow-y: auto; border-left: 3px solid #000;
      background-color: #3b2a1d;
      background-image:
        linear-gradient(45deg, rgba(0,0,0,0.18) 25%, transparent 25% 75%, rgba(0,0,0,0.18) 75%),
        linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25% 75%, rgba(255,255,255,0.05) 75%);
      background-size: 8px 8px, 8px 8px; background-position: 0 0, 4px 4px;
      box-shadow: -6px 0 0 rgba(0,0,0,0.25); transition: transform 0.25s ease; }
    .panel.closed { transform: translateX(100%); }

    /* Collapsed tab: a grass block on the edge */
    .tab { position: fixed; right: 0; top: 40%; z-index: 2147483647; display: none; cursor: pointer;
      padding: 12px 8px; writing-mode: vertical-rl; font-family: var(--caps); font-size: 12px;
      color: #fff; text-shadow: 2px 2px 0 #2b5c18; border: 3px solid #000; border-right: 0;
      background: #4c9a2f; box-shadow: inset 3px 3px 0 #86d36a, inset -3px -3px 0 #2b5c18; }
    .tab.show { display: block; }

    button:focus-visible, .tab:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

    /* Top bar */
    header { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
    .grass { width: 32px; height: 32px; flex: 0 0 auto; border: 3px solid #000;
      background: linear-gradient(#5ea73a 0 35%, transparent 35%),
        repeating-linear-gradient(90deg, #86592f 0 4px, #79502a 4px 8px);
      box-shadow: inset 3px 3px 0 rgba(255,255,255,0.25), inset -3px -3px 0 rgba(0,0,0,0.3); }
    .brand { flex: 1; min-width: 0; }
    h1 { font-family: var(--caps); font-size: 19px; font-weight: 700; margin: 0; line-height: 1;
      color: #e0e0e0; letter-spacing: 1px; text-shadow: 2px 2px 0 #3f3f3f, 3px 3px 0 #1a1a1a; }
    .kicker { font-size: 12px; color: #d9c7a5; }
    .close { font-family: var(--caps); font-size: 13px; color: #fff; cursor: pointer; width: 30px; height: 30px;
      background: #6f6f6f; border: 3px solid #000; text-shadow: 1px 1px 0 #3a3a3a;
      box-shadow: inset 2px 2px 0 #a8a8a8, inset -2px -2px 0 #3c3c3c; }
    .close:hover { background: #7f86c9; }

    /* Bevelled GUI panel */
    .gui { background: var(--gui); border: 3px solid #000; padding: 12px 13px; margin-bottom: 12px;
      box-shadow: inset 3px 3px 0 var(--gui-hi), inset -3px -3px 0 var(--gui-lo); }
    .gui[hidden], .askout[hidden], .btn[hidden] { display: none; }
    h2 { font-family: var(--caps); font-size: 11px; font-weight: 700; margin: 0 0 8px;
      color: #3f3f3f; letter-spacing: 0.5px; text-transform: uppercase; }

    /* Impact: big lightbulb-time count + inventory slots */
    .big { font-family: var(--caps); font-size: 24px; font-weight: 700; line-height: 1.1; color: #1f6b1a;
      text-shadow: 1px 1px 0 #fff; }
    .sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 10px;
      padding: 4px; background: #2b2b2b; border: 3px solid #000; }
    .slots.two { grid-template-columns: 1fr 1fr; }
    .slot { background: var(--slot); padding: 6px 4px; text-align: center; color: #fff; text-shadow: 1px 1px 0 #333;
      box-shadow: inset 3px 3px 0 var(--slot-lo), inset -3px -3px 0 var(--slot-hi); }
    .slot b { display: block; font-size: 14px; font-variant-numeric: tabular-nums; }
    .slot span { font-size: 10.5px; color: #eee; }
    .slot.green { background: var(--emerald); box-shadow: inset 3px 3px 0 #0b5e2a, inset -3px -3px 0 #4ade80; }

    /* Chat lines (flash + status) */
    .chat { background: var(--chat); color: #fff; padding: 7px 10px; margin-bottom: 12px; font-size: 13px;
      text-shadow: 1px 1px 0 #000; min-height: 1.4em; }
    .chat:empty { display: none; }

    /* Pickaxe hotbar for the five gears */
    .hotbar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 4px;
      background: #2b2b2b; border: 3px solid #000; margin-bottom: 12px; }
    .tool { display: flex; flex-direction: column; align-items: center; padding: 4px 0 3px;
      background: var(--slot); box-shadow: inset 3px 3px 0 var(--slot-lo), inset -3px -3px 0 var(--slot-hi); }
    .tool .n { align-self: flex-start; margin: -2px 0 -8px 4px; font-family: var(--caps); font-size: 9px;
      color: #fff; text-shadow: 1px 1px 0 #000; }
    .tool .nm { font-size: 9px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 #333; }
    .tool.on { background: #c6c6c6; box-shadow: 0 0 0 3px #fff, 0 0 0 6px #000,
      inset 3px 3px 0 var(--slot-lo), inset -3px -3px 0 var(--slot-hi); position: relative; z-index: 1; }
    .tool.on .nm { color: #000; text-shadow: none; }
    .pick { width: 32px; height: 32px; shape-rendering: crispEdges; }
    .pk-dark { fill: var(--head-dark); } .pk-light { fill: var(--head); }
    .pk-stick { fill: #8a6a3b; } .pk-stick2 { fill: #5b4325; }
    .t1 { --head: #c49a5c; --head-dark: #6b4f2a; --tier: #e3bf86; }
    .t2 { --head: #a3a3a3; --head-dark: #4f4f4f; --tier: #d6d6d6; }
    .t3 { --head: #f0f0f0; --head-dark: #8c8c8c; --tier: #ffffff; }
    .t4 { --head: #6af0e2; --head-dark: #178a83; --tier: #55ffff; }
    .t5 { --head: #6e6266; --head-dark: #2b2426; --tier: #d6a6ff; }

    /* Tooltip-style verdict under the hotbar */
    .tip { background: #100010; border: 3px solid #2a0a5c; padding: 9px 11px; color: #e6e6e6;
      text-shadow: 2px 2px 0 #2b2b2b; }
    .tip .tt { font-size: 15px; font-weight: 700; color: var(--tier); }
    .model { font-family: var(--caps); font-size: 15px; font-weight: 700; color: #fff; margin-top: 4px; }
    .reason { font-size: 12px; color: #a8a8ff; margin-top: 2px; }
    .pips { display: flex; gap: 3px; align-items: center; margin-top: 5px; }
    .pips::before { content: "Energy"; font-size: 11px; color: #a8a8a8; margin-right: 4px; }
    .pips i { width: 14px; height: 8px; background: #3a3a3a; border: 1px solid #000; }
    .pips i.on { background: #ffcf3f; }

    .advice { margin-top: 10px; padding: 9px 11px; font-size: 13.5px; line-height: 1.4; border: 3px solid #000; }
    .advice.save { background: var(--emerald); color: #fff; text-shadow: 1px 1px 0 #0b5e2a;
      box-shadow: inset 3px 3px 0 #4ade80, inset -3px -3px 0 #0b5e2a; }
    .advice.ok { background: #4c9a2f; color: #fff; text-shadow: 1px 1px 0 #2b5c18;
      box-shadow: inset 3px 3px 0 #86d36a, inset -3px -3px 0 #2b5c18; }
    .advice.up { background: #212121; color: #ffe08a; box-shadow: inset 2px 2px 0 #555, inset -2px -2px 0 #0d0d0d; }
    .empty { font-size: 13.5px; color: var(--muted); }

    /* Buttons */
    .btn { display: block; width: 100%; margin-top: 10px; font-family: var(--pixel); font-size: 15px; font-weight: 700;
      color: #fff; text-shadow: 2px 2px 0 #2b5c18; background: #4c9a2f; border: 3px solid #000; padding: 7px 14px;
      cursor: pointer; box-shadow: inset 3px 3px 0 #86d36a, inset -3px -3px 0 #2b5c18; }
    .btn:hover { background: #5cb239; }
    .btn:active { box-shadow: inset -3px -3px 0 #86d36a, inset 3px 3px 0 #2b5c18; }
    .btn:disabled { opacity: 0.65; cursor: progress; }
    .btn.small { display: inline-block; width: auto; font-size: 12px; padding: 3px 10px; margin-top: 8px;
      background: #6f6f6f; text-shadow: 1px 1px 0 #3a3a3a; box-shadow: inset 2px 2px 0 #a8a8a8, inset -2px -2px 0 #3c3c3c; }

    /* Ask here: book page for the answer */
    .asksub { font-size: 13px; color: var(--muted); }
    .askout { margin-top: 10px; white-space: pre-wrap; background: #f4e7c5; color: #2b2111; border: 3px solid #000;
      box-shadow: inset 3px 3px 0 #fff6dc, inset -3px -3px 0 #c9b27c; padding: 10px 12px; font-size: 14px;
      max-height: 260px; overflow-y: auto; }
    .askmeta { font-size: 11.5px; color: var(--muted); margin-top: 6px; }

    /* Tighten: chat-bar preview */
    .tnum { font-family: var(--caps); font-size: 14px; font-weight: 700; color: #1f6b1a; }
    .tfix { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .tprev { margin-top: 8px; background: var(--chat); color: #fff; text-shadow: 1px 1px 0 #000; border: 2px solid #000;
      padding: 8px 10px; font-size: 13.5px; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
    .tprev::before { content: "> "; color: #7ee36b; font-weight: 700; }

    /* Footer */
    footer { font-size: 11px; color: #d9c7a5; line-height: 1.4; }
    footer .chat { margin-bottom: 8px; font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border: 2px solid #000; margin-right: 6px; vertical-align: -1px; }

    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `;

  // One pixel-art pickaxe (same art as the popup), recoloured per gear tier.
  const PICK = `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="ds-pick" viewBox="0 0 16 16">
        <path class="pk-dark" d="M3 1h4v1h-4zM3 2h1v1h-1zM7 2h2v1h-2zM3 3h3v1h-3zM9 3h1v1h-1zM6 4h2v1h-2zM10 4h1v1h-1zM8 5h1v1h-1zM11 5h1v1h-1zM9 6h1v1h-1zM12 6h1v1h-1zM10 7h1v1h-1zM13 7h1v1h-1zM11 8h1v1h-1zM13 8h1v1h-1zM11 9h1v1h-1zM14 9h1v3h-1zM12 10h1v2h-1zM12 12h3v1h-3z" />
        <path class="pk-light" d="M4 2h3v1h-3zM6 3h3v1h-3zM8 4h2v1h-2zM9 5h2v1h-2zM10 6h2v1h-2zM11 7h2v1h-2zM12 8h1v1h-1zM12 9h2v1h-2zM13 10h1v2h-1z" />
        <path class="pk-stick" d="M12 3h1v1h-1zM8 7h1v1h-1zM6 9h1v1h-1zM4 11h1v1h-1zM2 13h1v1h-1z" />
        <path class="pk-stick2" d="M11 4h1v1h-1zM7 8h1v1h-1zM5 10h1v1h-1zM3 12h1v1h-1zM1 14h1v1h-1z" />
      </symbol>
    </svg>`;

  const EMPTY = `<div class="empty">Type a question. I'll tell you which Claude model fits it and how much energy you can save.</div>`;

  const HTML = `
    ${PICK}
    <button class="tab" aria-label="Open TokenWise">TokenWise</button>
    <aside class="panel closed" role="complementary" aria-label="TokenWise">
      <header>
        <span class="grass" aria-hidden="true"></span>
        <div class="brand"><h1>TokenWise</h1><span class="kicker">Right tool, less power</span></div>
        <button class="close" aria-label="Close TokenWise">X</button>
      </header>
      <section class="gui" aria-label="Your impact">
        <h2>Your impact</h2>
        <div class="big" data-k="tree">💡 0 sec</div>
        <div class="sub">of lightbulb power saved so far</div>
        <div class="slots">
          <div class="slot green"><b data-k="co2">0 g</b><span>CO₂ kept out of the air</span></div>
          <div class="slot"><b data-k="o2">0</b><span>answered without Claude</span></div>
          <div class="slot"><b data-k="wh">0 Wh</b><span>energy saved</span></div>
        </div>
      </section>
      <div class="chat" data-k="flash" aria-live="polite"></div>
      <section class="gui" aria-label="This prompt">
        <h2>Your question</h2>
        <div data-k="live">${EMPTY}</div>
      </section>
      <section class="gui ask" aria-label="Ask here instead" data-k="ask" hidden>
        <h2>⚡ Answer it here, no Claude needed</h2>
        <div class="asksub" data-k="asksub">This one's easy. A tiny AI can answer it with a fraction of the energy.</div>
        <button class="btn" data-k="askbtn">Answer it here</button>
        <div class="askout" data-k="askout" aria-live="polite" hidden></div>
        <div class="askmeta" data-k="askmeta"></div>
      </section>
      <section class="gui tight" aria-label="Tighten your prompt" data-k="tight" hidden>
        <h2>✂ Shorter prompt, same meaning</h2>
        <div class="tnum" data-k="tnum"></div>
        <div class="tfix" data-k="tfix"></div>
        <div class="tprev" data-k="tprev"></div>
        <button class="btn" data-k="apply">Use shorter version</button>
      </section>
      <section class="gui" aria-label="Your footprint">
        <h2>Your AI footprint</h2>
        <div class="slots two">
          <div class="slot"><b data-k="prompts">0</b><span>questions asked</span></div>
          <div class="slot green"><b data-k="right">–</b><span>used the right model</span></div>
          <div class="slot"><b data-k="used">0 Wh</b><span>energy you used</span></div>
          <div class="slot"><b data-k="emitted">0 g</b><span>CO₂ you caused</span></div>
        </div>
      </section>
      <footer>
        <div class="chat"><span class="dot" data-k="dot"></span><span data-k="engine">Checking engine…</span></div>
        <div>Lightbulb = a 10 W LED. Claude model energy is estimated; our GPU's energy is measured live.
        CO₂ uses the New England grid (≈ ${DS.G_CO2_PER_WH} g per Wh).</div>
        <button class="btn small" data-k="reset">Reset my stats</button>
      </footer>
    </aside>`;

  let root, panel, tab;
  const $ = (k) => root.querySelector(`[data-k="${k}"]`);

  function mount() {
    if (document.getElementById("downshift-root")) return;
    const host = document.createElement("div");
    host.id = "downshift-root";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    panel = root.querySelector(".panel");
    tab = root.querySelector(".tab");
    root.querySelector(".close").addEventListener("click", () => setOpen(false));
    tab.addEventListener("click", () => setOpen(true));
    $("apply").addEventListener("click", applyTighten);
    $("askbtn").addEventListener("click", askHere);
    $("reset").addEventListener("click", () => {
      stats = { prompts: 0, right_sized: 0, wh_used: 0, wh_saved: 0, local: 0 };
      saveStats();
      renderImpact();
    });
    renderEngine();
  }

  function setOpen(open) {
    panel.classList.toggle("closed", !open);
    tab.classList.toggle("show", !open);
  }

  // --- formatting ---------------------------------------------------------------
  // Energy as time a 10 W LED bulb could run on it: 1 Wh = 6 minutes of light.
  function fmtBulb(wh) {
    const sec = wh * 360;
    if (sec < 60) return `${Math.round(sec)} sec`;
    if (sec < 3600) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)} min`;
    return `${(sec / 3600).toFixed(1)} hours`;
  }
  const fmtG = (g) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 2 : 0)} g`);
  const fmtWh = (wh) => (wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${wh.toFixed(2)} Wh`);

  function renderImpact() {
    if (!root) return;
    const i = DS.impact(stats.wh_saved);
    $("tree").textContent = `💡 ${fmtBulb(i.wh)}`;
    $("co2").textContent = fmtG(i.co2_g);
    $("o2").textContent = String(stats.local || 0);
    $("wh").textContent = fmtWh(i.wh);
    $("prompts").textContent = String(stats.prompts);
    $("right").textContent = stats.prompts ? `${Math.round((stats.right_sized / stats.prompts) * 100)}%` : "–";
    $("used").textContent = fmtWh(stats.wh_used);
    $("emitted").textContent = fmtG(DS.co2(stats.wh_used));
  }

  function renderEngine() {
    $("dot").style.background = engineLive ? "#22c55e" : "#eab308";
    $("engine").textContent = engineLive ? "Smart picker online" : "Smart picker in basic mode (engine offline)";
  }

  // --- live recommendation ---------------------------------------------------------
  let last = null; // { prompt, gear, model, current }

  function renderLive(t, prompt) {
    const g = DS.GEARS[t.gear];
    const rec = DS.GEAR_MODEL[t.gear];
    const current = detectModel() || DEFAULT_MODEL;
    last = { prompt, gear: t.gear, model: rec, current };

    const gears = [1, 2, 3, 4, 5]
      .map((n) => {
        const on = n === t.gear ? " on" : "";
        return `<div class="tool t${n}${on}" role="listitem" aria-current="${!!on}">
          <span class="n" aria-hidden="true">${n}</span>
          <svg class="pick" aria-hidden="true" focusable="false"><use href="#ds-pick" /></svg>
          <span class="nm">${DS.GEARS[n].label}</span></div>`;
      })
      .join("");
    const pips = [1, 2, 3, 4, 5].map((n) => `<i${n <= t.gear ? ' class="on"' : ""}></i>`).join("");

    let advice;
    const diff = DS.WH_PER_ANSWER[current] - DS.WH_PER_ANSWER[rec];
    if (diff > 0) {
      const i = DS.impact(diff);
      advice = `<div class="advice save">You're on <b>${current}</b>. <b>Switch to ${rec}</b>:
        <b>~${Math.round((diff / DS.WH_PER_ANSWER[current]) * 100)}% less energy</b> (estimate)
        · 💡 ${fmtBulb(diff)} of lightbulb power.</div>`;
    } else if (diff < 0) {
      advice = `<div class="advice up">You're on <b>${current}</b>. This one is hard. <b>Switch to ${rec}</b> for a good answer.</div>`;
    } else {
      advice = `<div class="advice ok">You're on <b>${current}</b>. Perfect pick for this question. 👍</div>`;
    }

    const live = $("live");
    live.innerHTML = `
      <div class="hotbar" role="list" aria-label="Gear ${t.gear} of 5">${gears}</div>
      <div class="tip t${t.gear}">
        <div class="tt">Gear ${t.gear}: ${g.label}</div>
        <div class="model">Use Claude ${rec}</div>
        <div class="reason">${Math.round(t.confidence * 100)}% confident</div>
        <div class="pips" aria-hidden="true">${pips}</div>
      </div>
      ${advice}`;
    // reason comes from the engine; set as text, never HTML
    const why = document.createElement("div");
    why.className = "reason";
    why.textContent = `Why: ${t.reason}`;
    live.querySelector(".model").after(why);
    renderEngine();
    renderAsk(t.gear);
  }

  // --- ask here: simple prompts skip Claude entirely ---------------------------------
  // Haiku-level prompts (Gears 1-2) get answered right here: plain arithmetic by
  // the in-browser calculator, everything else by the engine's /v1/answer, which
  // routes to the small Colab models and measures the energy used.
  let askState = "idle"; // idle | loading | answered

  function renderAsk(gear) {
    if (askState === "loading") return;
    askState = "idle";
    const card = $("ask");
    card.hidden = gear > 2;
    $("askbtn").hidden = false;
    $("askbtn").disabled = false;
    $("askbtn").textContent = "Answer it here";
    $("askout").hidden = true;
    $("askout").textContent = "";
    $("askmeta").textContent = "";
  }

  function hideAsk() {
    if (askState !== "idle") return;
    if (root) $("ask").hidden = true;
  }

  // Resolves { data } on success or { error } with the real reason, so the
  // card can say whether the engine is down or the page needs a refresh.
  function askEngine(prompt) {
    const stale = "TokenWise was reloaded. Refresh this tab (F5) and try again.";
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "ds.answer", body: { prompt, mode: "auto", source: "extension" } },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (err) return resolve({ error: /context invalidated|Receiving end/i.test(err.message) ? stale : err.message });
            if (resp && resp.ok) return resolve({ data: resp.data });
            const why = (resp && resp.error) || "no response";
            resolve({ error: /abort/i.test(why) ? "The tiny AI took too long (Colab may be asleep)." : `Couldn't reach the TokenWise engine on localhost:8000 (${why}).` });
          }
        );
      } catch (e) {
        resolve({ error: stale });
      }
    });
  }

  // Empty claude.ai's composer so the prompt isn't also sent to Claude.
  function clearComposer() {
    const el = findComposer();
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (!(document.execCommand && document.execCommand("delete"))) el.textContent = "";
  }

  async function askHere() {
    if (!last || askState === "loading") return;
    const { prompt, current } = last;
    askState = "loading";
    const btn = $("askbtn");
    btn.disabled = true;
    btn.textContent = "Thinking…";

    let text, meta, whUsed;
    const quick = DS.quickAnswer(prompt);
    if (quick !== null) {
      text = quick;
      whUsed = 0;
      meta = "Solved instantly. No AI needed, zero energy";
    } else {
      const res = await askEngine(prompt);
      if (res.error) {
        askState = "idle";
        btn.disabled = false;
        btn.textContent = "Answer it here";
        $("askmeta").textContent = res.error;
        return;
      }
      const r = res.data;
      text = r.text;
      whUsed = (Number(r.energy_j) || 0) / 3600;
      const how = r.energy_source === "measured" ? "measured live" : "estimated";
      meta = `Answered by a tiny AI (${r.model}) in ${(r.latency_ms / 1000).toFixed(1)}s, using 💡 ${fmtBulb(whUsed)} of lightbulb power (${how})`;
    }

    const whSaved = Math.max(0, DS.WH_PER_ANSWER[current] - whUsed);
    stats.prompts += 1;
    stats.right_sized += 1;
    stats.local = (stats.local || 0) + 1;
    stats.wh_used += whUsed;
    stats.wh_saved += whSaved;
    saveStats();
    renderImpact();

    askState = "answered";
    btn.hidden = true;
    $("askout").textContent = text;
    $("askout").hidden = false;
    $("askmeta").textContent = `${meta}. Saved 💡 ${fmtBulb(whSaved)} vs ${current}.`;
    $("flash").textContent = `💡 +${fmtBulb(whSaved)} of lightbulb power saved, answered without Claude`;
    setTimeout(() => ($("flash").textContent = ""), 4000);

    pastedExtra = [];
    clearComposer();
    clearLive();
  }

  // --- tighten ----------------------------------------------------------------------
  let tightText = null;

  function renderTighten() {
    const card = $("tight");
    const raw = composerText(findComposer());
    const r = raw.length >= 3 ? DS.tighten(raw) : null;
    // Only worth a nudge when it saves at least 2 tokens and 10%.
    if (!r || r.saved < 2 || r.saved / r.before < 0.1) {
      tightText = null;
      card.hidden = true;
      return;
    }
    tightText = r.text;
    $("tnum").textContent = `${Math.round((r.saved / r.before) * 100)}% shorter for the AI`;
    $("tfix").textContent = `${r.before} → ${r.after} tokens (the pieces AI reads). Removed: ${r.changes.join(", ")}`;
    $("tprev").textContent = r.text;
    card.hidden = false;
  }

  // Replace the composer text through the editor's own input path, so
  // claude.ai's ProseMirror state stays in sync.
  function applyTighten() {
    const el = findComposer();
    if (!el || !tightText) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand && document.execCommand("insertText", false, tightText);
    if (!ok) {
      el.textContent = tightText;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }
    $("flash").textContent = "✂ Prompt shortened";
    setTimeout(() => ($("flash").textContent = ""), 3000);
    onInput();
  }

  function clearLive() {
    if (root) $("tight").hidden = true;
    hideAsk(); // an answer on screen stays until the next prompt or chat
    tightText = null;
    // Drop any pending or in-flight triage so a late reply can't bring the
    // old suggestion back after a send or delete.
    clearTimeout(timer);
    seq++;
    last = null;
    if (root) $("live").innerHTML = EMPTY;
  }

  // claude.ai turns long pastes into a "Pasted content" attachment instead of
  // composer text, so keep pasted text that didn't land in the composer.
  let pastedExtra = [];

  function onPaste(e) {
    const text = ((e.clipboardData && e.clipboardData.getData("text/plain")) || "").trim();
    if (!text) return;
    setTimeout(() => {
      const inComposer = composerText(findComposer()).includes(text.slice(0, 40));
      if (!inComposer) pastedExtra.push(text);
      onInput();
    }, 150);
  }

  function currentPrompt() {
    return [composerText(findComposer()), ...pastedExtra].join("\n").trim().slice(0, 4000);
  }

  let timer = null;
  let seq = 0;
  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const prompt = currentPrompt();
      if (prompt.length < 3) return clearLive();
      renderTighten();
      const mine = ++seq;
      const t = await triage(prompt);
      if (mine === seq) renderLive(t, prompt);
    }, DEBOUNCE_MS);
  }

  // --- sending: add the prompt to the footprint ---------------------------------------
  let chatBaseline = null; // model selected when this chat opened
  let lastSent = { text: "", at: 0 };

  // Announce a prompt really sent to Claude (/v1/triage observe mode, see
  // contracts/api.md) so the engine's Triage + Coordinator route it and the Grid
  // Room sparks it. No answer is generated. Engine offline is fine: fire and forget.
  function observe(prompt) {
    const promptId = "claude-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    try {
      chrome.runtime.sendMessage(
        { type: "ds.triage", body: { prompt, observe: true, prompt_id: promptId } },
        () => void chrome.runtime.lastError
      );
    } catch (e) {
      /* extension reloaded under the page */
    }
  }

  function recordSend() {
    const prompt = currentPrompt();
    if ((!last || last.prompt !== prompt) && prompt.length >= 3) {
      // Sent before triage caught up: score it with the instant rules.
      const t = DS.demoPin(prompt) || DS.rulesTriage(prompt);
      last = { prompt, gear: t.gear, model: DS.GEAR_MODEL[t.gear], current: detectModel() || DEFAULT_MODEL };
    }
    if (!last) return;
    const now = Date.now();
    if (last.prompt === lastSent.text && now - lastSent.at < 3000) return;
    lastSent = { text: last.prompt, at: now };
    observe(last.prompt);

    const used = detectModel() || last.current;
    const baseline = chatBaseline || used;
    const whUsed = DS.WH_PER_ANSWER[used];
    const whSaved = Math.max(0, DS.WH_PER_ANSWER[baseline] - whUsed);

    stats.prompts += 1;
    if (used === last.model) stats.right_sized += 1;
    stats.wh_used += whUsed;
    stats.wh_saved += whSaved;
    saveStats();
    renderImpact();

    const flash = $("flash");
    if (whSaved > 0) {
      flash.textContent = `💡 +${fmtBulb(whSaved)} of lightbulb power saved by using ${used}`;
    } else if (used === last.model) {
      flash.textContent = "✓ Right model picked";
    } else {
      flash.textContent = "";
    }
    setTimeout(() => (flash.textContent = ""), 4000);
    pastedExtra = [];
    clearLive();
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const c = findComposer();
      if (c && c.contains(e.target)) recordSend();
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest && e.target.closest('button[aria-label*="send" i]');
      if (b) recordSend();
    },
    true
  );

  // --- wiring ----------------------------------------------------------------------------
  // Listen on the document, not the composer element: claude.ai swaps the
  // composer node on navigation, which silently dropped per-element listeners.
  const inComposer = (t) => {
    const c = findComposer();
    return !!(c && t && (c === t || c.contains(t)));
  };
  document.addEventListener(
    "input",
    (e) => {
      if (!inComposer(e.target)) return;
      // Clearing the box by hand also drops pasted text we were holding.
      if (/^delete/.test(e.inputType || "") && !composerText(findComposer())) pastedExtra = [];
      onInput();
    },
    true
  );
  // Removing a pasted-content chip from the composer form drops its text too.
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest && e.target.closest('button[aria-label*="remove" i], button[aria-label*="delete" i]');
      if (b && b.closest("form, fieldset")) {
        pastedExtra = [];
        setTimeout(onInput, 150);
      }
    },
    true
  );
  document.addEventListener("paste", (e) => inComposer(e.target) && onPaste(e), true);
  document.addEventListener("drop", (e) => inComposer(e.target) && setTimeout(onInput, 150), true);

  // claude.ai is a single-page app: watch for route changes to spot new chats.
  let lastPath = null;
  function onRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    pastedExtra = [];
    if (askState === "answered") askState = "idle";
    clearLive();
    if (isNewChat()) {
      chatBaseline = null;
      setOpen(true);
    }
  }

  function tick() {
    onRoute();
    // claude.ai empties the composer in code after a send, often without an
    // input event, so check the box itself and clear a stale suggestion.
    if (last && currentPrompt().length < 3) clearLive();
    if (!chatBaseline) chatBaseline = detectModel();
  }

  mount();
  loadStats();
  setOpen(isNewChat());
  if (!isNewChat()) tab.classList.add("show");
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 1000);
  tick();
})();

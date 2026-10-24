// A: Downshift sidebar on claude.ai.
// Opens on every new chat. While you type it shows the prompt's gear, the Claude
// model that fits it, and the energy you'd save by switching. Each sent prompt
// is added to a per-user footprint (chrome.storage.local) shown at the top as
// CO2, tree-time and oxygen saved. All energy numbers are estimates (estimates.js).

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
  let stats = { prompts: 0, right_sized: 0, wh_used: 0, wh_saved: 0 };

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
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: 320px; z-index: 2147483647;
      background: #f4f7f2; color: #1c2b22; border-left: 1px solid #d5e0d2;
      box-shadow: -8px 0 24px rgba(0,0,0,0.08); display: flex; flex-direction: column;
      transition: transform 0.25s ease; overflow-y: auto; }
    .panel.closed { transform: translateX(100%); }
    .tab { position: fixed; right: 0; top: 40%; z-index: 2147483647; background: #2f6b45; color: #fff;
      border: none; border-radius: 10px 0 0 10px; padding: 10px 8px; cursor: pointer; font-size: 13px;
      font-weight: 600; writing-mode: vertical-rl; display: none; }
    .tab.show { display: block; }
    .tab:focus-visible, button:focus-visible { outline: 2px solid #1c2b22; outline-offset: 2px; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
    .brand { font-weight: 700; font-size: 15px; color: #2f6b45; }
    .close { background: none; border: none; font-size: 20px; color: #5b6b60; cursor: pointer; line-height: 1; }
    .impact { margin: 0 12px; padding: 14px; border-radius: 14px; background: #2f6b45; color: #fff; }
    .impact .big { font-size: 26px; font-weight: 700; line-height: 1.1; }
    .impact .sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
    .stat { background: rgba(255,255,255,0.14); border-radius: 10px; padding: 8px 6px; text-align: center; }
    .stat b { display: block; font-size: 15px; }
    .stat span { font-size: 10.5px; opacity: 0.9; }
    .flash { font-size: 12px; font-weight: 600; color: #d9f99d; height: 16px; margin-top: 6px; }
    .card { margin: 12px; padding: 14px; border-radius: 14px; background: #fff; border: 1px solid #dfe7dc; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6b60; }
    .gears { display: flex; gap: 6px; margin: 8px 0 4px; }
    .g { flex: 1; text-align: center; padding: 6px 0; border-radius: 8px; font-size: 11px; font-weight: 600;
      background: #eef2ec; color: #7a877e; border: 2px solid transparent; }
    .g.on { color: #1c2b22; border-color: #1c2b22; }
    .model { font-size: 22px; font-weight: 700; margin-top: 8px; }
    .reason { font-size: 12px; color: #5b6b60; margin-top: 2px; }
    .advice { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4; }
    .advice.save { background: #ecfccb; color: #365314; }
    .advice.ok { background: #e7f5ec; color: #1f5135; }
    .advice.up { background: #fff4e5; color: #7c3f00; }
    .empty { font-size: 13px; color: #5b6b60; }
    .rows { font-size: 12.5px; }
    .rows div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e3e9e1; }
    .rows div:last-child { border-bottom: none; }
    footer { margin: auto 12px 12px; font-size: 10.5px; color: #6b7a70; line-height: 1.4; }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
    .reset { background: none; border: none; color: #6b7a70; text-decoration: underline; cursor: pointer; font-size: 10.5px; padding: 0; }
  `;

  const HTML = `
    <button class="tab" aria-label="Open Downshift">🌱 Downshift</button>
    <aside class="panel closed" role="complementary" aria-label="Downshift">
      <header><div class="brand">🌱 Downshift</div>
        <button class="close" aria-label="Close Downshift">×</button></header>
      <section class="impact" aria-label="Your impact">
        <div class="big" data-k="tree">0 tree-min</div>
        <div class="sub">of a tree's CO₂ absorption saved, all time</div>
        <div class="grid3">
          <div class="stat"><b data-k="co2">0 g</b><span>CO₂ avoided</span></div>
          <div class="stat"><b data-k="o2">0 g</b><span>O₂ equiv.</span></div>
          <div class="stat"><b data-k="wh">0 Wh</b><span>energy saved</span></div>
        </div>
        <div class="flash" data-k="flash" aria-live="polite"></div>
      </section>
      <section class="card" aria-label="This prompt">
        <div class="label">This prompt</div>
        <div data-k="live"><div class="empty">Start typing — I'll pick the right gear and model.</div></div>
      </section>
      <section class="card" aria-label="Your footprint">
        <div class="label">Your footprint</div>
        <div class="rows">
          <div><span>Prompts tracked</span><b data-k="prompts">0</b></div>
          <div><span>Sent on the right-size model</span><b data-k="right">–</b></div>
          <div><span>Energy used</span><b data-k="used">0 Wh</b></div>
          <div><span>CO₂ emitted</span><b data-k="emitted">0 g</b></div>
        </div>
      </section>
      <footer>
        <div><span class="dot" data-k="dot"></span><span data-k="engine">Checking engine…</span></div>
        <div style="margin-top:6px">Estimates: per-answer energy scaled from a 0.24 Wh median prompt by
        relative model price; New England grid ≈ ${DS.G_CO2_PER_WH} g CO₂/Wh; a tree absorbs ≈ 22 kg CO₂/yr.</div>
        <button class="reset" data-k="reset">Reset my stats</button>
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
    $("reset").addEventListener("click", () => {
      stats = { prompts: 0, right_sized: 0, wh_used: 0, wh_saved: 0 };
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
  function fmtTree(min) {
    if (min < 60) return `${min.toFixed(min < 10 ? 1 : 0)} tree-min`;
    if (min < 60 * 24) return `${(min / 60).toFixed(1)} tree-hours`;
    return `${(min / 1440).toFixed(1)} tree-days`;
  }
  const fmtG = (g) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 2 : 0)} g`);
  const fmtWh = (wh) => (wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${wh.toFixed(2)} Wh`);

  function renderImpact() {
    if (!root) return;
    const i = DS.impact(stats.wh_saved);
    $("tree").textContent = fmtTree(i.tree_min);
    $("co2").textContent = fmtG(i.co2_g);
    $("o2").textContent = fmtG(i.o2_g);
    $("wh").textContent = fmtWh(i.wh);
    $("prompts").textContent = String(stats.prompts);
    $("right").textContent = stats.prompts ? `${Math.round((stats.right_sized / stats.prompts) * 100)}%` : "–";
    $("used").textContent = fmtWh(stats.wh_used);
    $("emitted").textContent = fmtG(DS.co2(stats.wh_used));
  }

  function renderEngine() {
    $("dot").style.background = engineLive ? "#22c55e" : "#eab308";
    $("engine").textContent = engineLive ? "Classifier: Downshift engine (live)" : "Classifier: offline rules";
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
        const on = n === t.gear;
        const style = on ? ` style="background:${DS.GEARS[n].color}33"` : "";
        return `<div class="g${on ? " on" : ""}"${style} aria-current="${on}">${n}<br>${DS.GEARS[n].label}</div>`;
      })
      .join("");

    let advice;
    const diff = DS.WH_PER_ANSWER[current] - DS.WH_PER_ANSWER[rec];
    if (diff > 0) {
      const i = DS.impact(diff);
      advice = `<div class="advice save">You're on <b>${current}</b>. Switch to <b>${rec}</b> to save
        ~${fmtWh(diff)} on this answer (${fmtG(i.co2_g)} CO₂ ≈ ${fmtTree(i.tree_min)}).
        ${Math.round((diff / DS.WH_PER_ANSWER[current]) * 100)}% less energy.</div>`;
    } else if (diff < 0) {
      advice = `<div class="advice up">You're on <b>${current}</b>. This one may need <b>${rec}</b> for a good answer.</div>`;
    } else {
      advice = `<div class="advice ok">You're on <b>${current}</b> — right gear for this prompt. 👍</div>`;
    }

    const live = $("live");
    live.innerHTML = `
      <div class="gears" role="list" aria-label="Gear ${t.gear} of 5">${gears}</div>
      <div class="model">Best fit: Claude ${rec}</div>
      <div class="reason">Gear ${t.gear} · ${g.label} · ${Math.round(t.confidence * 100)}% sure</div>
      ${advice}`;
    // reason comes from the engine; set as text, never HTML
    const why = document.createElement("div");
    why.className = "reason";
    why.textContent = `Why: ${t.reason}`;
    live.querySelector(".model").after(why);
    renderEngine();
  }

  function clearLive() {
    last = null;
    if (root) $("live").innerHTML = `<div class="empty">Start typing — I'll pick the right gear and model.</div>`;
  }

  let timer = null;
  let seq = 0;
  function onInput(el) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const prompt = composerText(el);
      if (prompt.length < 3) return clearLive();
      const mine = ++seq;
      const t = await triage(prompt);
      if (mine === seq) renderLive(t, prompt);
    }, DEBOUNCE_MS);
  }

  // --- sending: add the prompt to the footprint ---------------------------------------
  let chatBaseline = null; // model selected when this chat opened
  let lastSent = { text: "", at: 0 };

  function recordSend() {
    if (!last) return;
    const now = Date.now();
    if (last.prompt === lastSent.text && now - lastSent.at < 3000) return;
    lastSent = { text: last.prompt, at: now };

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
      flash.textContent = `+${fmtTree(DS.impact(whSaved).tree_min)} saved by using ${used} 🌱`;
    } else if (used === last.model) {
      flash.textContent = "Right-sized ✓";
    } else {
      flash.textContent = "";
    }
    setTimeout(() => (flash.textContent = ""), 4000);
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
  function attach() {
    const el = findComposer();
    if (!el || el.dataset.downshiftBound) return;
    el.dataset.downshiftBound = "1";
    el.addEventListener("input", () => onInput(el));
  }

  // claude.ai is a single-page app: watch for route changes to spot new chats.
  let lastPath = null;
  function onRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (isNewChat()) {
      chatBaseline = null;
      clearLive();
      setOpen(true);
    }
  }

  function tick() {
    attach();
    onRoute();
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

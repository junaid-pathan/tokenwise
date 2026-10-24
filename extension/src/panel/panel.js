// Downshift side panel entry point. Wires the DOM to the pure logic modules.
// MV3: this is loaded as type="module"; no inline scripts anywhere.

import { GEARS, GRID_LEVELS } from "./gears.mjs";
import { createShifter, POSITIONS } from "./shifter.mjs";
import { formatSavedRange, formatAnswerEnergy } from "./energy.mjs";
import {
  initialGridState,
  reduce,
  levelWord,
  levelColor,
  bannerFor,
  formatLoad,
} from "./reducer.mjs";
import { connectStream, postAnswer } from "./net.mjs";
import { resolveBase, readQueryApi } from "./config.mjs";
import { parseHandoff, isOpenMessage } from "./handoff.mjs";
import { getItem, setItem, takePending } from "./storage.mjs";
import { GUIDE_CARDS, GUIDE_SEEN_KEY } from "./guide.mjs";

const $ = (id) => document.getElementById(id);
const API_STORAGE_KEY = "downshift_api";

// ---- state ----
let gridState = initialGridState();
let lastLevel = null;
// Once a connection attempt fails, we treat the engine as offline and
// reconnect silently in the background rather than flapping back to
// "Connecting" on every retry. "Connecting" is only shown on the first attempt.
let everFailed = false;
const shifter = createShifter("auto");

// ---- grid light + banner + narrator rendering ----
function setLevelColorVar(level) {
  const color = levelColor(level);
  document.documentElement.style.setProperty("--level-color", color);
}

function renderGrid() {
  const word = $("grid-word");
  const load = $("grid-load");
  const light = $("grid-light");
  const sim = gridState.synthetic ? " (Simulated)" : "";

  if (gridState.connection === "offline") {
    word.textContent = "Engine offline";
    load.textContent = "";
    light.setAttribute("aria-label", "Grid status: engine offline");
    document.documentElement.style.setProperty("--level-color", "#8b949e");
    return;
  }
  // Only the first attempt (before any failure) shows "Connecting". After a
  // failure we keep showing "Engine offline" while reconnecting silently, so
  // the user sees a clear, stable offline state rather than endless flapping.
  if (gridState.connection === "connecting" && gridState.level == null) {
    if (everFailed) {
      word.textContent = "Engine offline";
      load.textContent = "";
      light.setAttribute("aria-label", "Grid status: engine offline, reconnecting");
      document.documentElement.style.setProperty("--level-color", "#8b949e");
    } else {
      word.textContent = "Connecting";
      load.textContent = "";
      light.setAttribute("aria-label", "Grid status: connecting");
    }
    return;
  }

  const w = levelWord(gridState.level);
  word.textContent = w + sim;
  load.textContent = formatLoad(gridState.load_mw);
  setLevelColorVar(gridState.level);
  light.setAttribute(
    "aria-label",
    `Grid level ${w}. Load ${formatLoad(gridState.load_mw)}.${sim}`
  );
}

function renderBanner() {
  const el = $("banner");
  const b = bannerFor(gridState.level);
  if (!b) {
    el.removeAttribute("data-kind");
    el.textContent = "";
    return;
  }
  el.setAttribute("data-kind", b.kind);
  el.textContent = b.text + (gridState.synthetic ? " (Simulated)" : "");
}

function renderNarrator() {
  const el = $("narrator-text");
  if (gridState.narrator) {
    el.textContent = gridState.narrator + (gridState.synthetic ? " (Simulated)" : "");
  }
}

function announce(msg) {
  const live = $("live");
  live.textContent = "";
  // Force re-announce by yielding a tick.
  setTimeout(() => {
    live.textContent = msg;
  }, 30);
}

function handleEvent(evt) {
  const before = gridState;
  gridState = reduce(gridState, evt);
  if (gridState === before) return;
  renderGrid();
  renderBanner();
  renderNarrator();

  if (gridState.level !== lastLevel && gridState.level != null) {
    lastLevel = gridState.level;
    announce(`Grid is now ${levelWord(gridState.level)}.`);
  }
  if (evt && evt.type === "narrator.line" && gridState.narrator) {
    announce(`Narrator: ${gridState.narrator}`);
  }
}

function setConnection(status) {
  if (status === "offline") everFailed = true;
  if (status === "online") everFailed = false;
  gridState = { ...gridState, connection: status };
  renderGrid();
}

// ---- shifter ----
const gearButtons = () => Array.from(document.querySelectorAll("#shifter .gear"));

function posFromAttr(v) {
  return v === "auto" ? "auto" : Number(v);
}

function renderShifter() {
  const current = shifter.position();
  gearButtons().forEach((btn) => {
    const pos = posFromAttr(btn.dataset.pos);
    const checked = pos === current;
    btn.setAttribute("aria-checked", checked ? "true" : "false");
    // Roving tabindex: only the checked radio is in the tab order.
    btn.tabIndex = checked ? 0 : -1;
  });
}

function selectPosition(pos, { focus = false } = {}) {
  shifter.set(pos);
  renderShifter();
  if (focus) {
    const btn = gearButtons().find((b) => posFromAttr(b.dataset.pos) === pos);
    if (btn) btn.focus();
  }
}

function wireShifter() {
  const group = $("shifter");
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".gear");
    if (!btn) return;
    selectPosition(posFromAttr(btn.dataset.pos));
  });
  group.addEventListener("keydown", (e) => {
    let handled = true;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        selectPosition(shifter.next(), { focus: true });
        break;
      case "ArrowLeft":
      case "ArrowUp":
        selectPosition(shifter.prev(), { focus: true });
        break;
      case "Home":
        selectPosition(shifter.home(), { focus: true });
        break;
      case "End":
        selectPosition(shifter.end(), { focus: true });
        break;
      case " ":
      case "Enter": {
        const btn = e.target.closest(".gear");
        if (btn) selectPosition(posFromAttr(btn.dataset.pos));
        break;
      }
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });
  renderShifter();
}

// ---- answer view ----
let base = null;

function renderAnswer(data) {
  const box = $("answer");
  const textEl = $("answer-text");
  const meta = $("answer-meta");
  const err = $("answer-error");
  err.hidden = true;

  const gear = GEARS.find((g) => g.gear === data.gear_used);
  const gearName = gear ? `${gear.tier} pickaxe · Gear ${gear.gear}` : `Gear ${data.gear_used}`;

  textEl.textContent = data.text || "(no text)";
  meta.innerHTML = "";
  const chips = [
    gearName,
    `${data.latency_ms} ms`,
    formatAnswerEnergy(data.energy_j, data.energy_source),
  ];
  chips.forEach((c) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = c;
    meta.appendChild(span);
  });
  const saved = document.createElement("span");
  saved.className = "chip saved";
  saved.textContent = `saved ${formatSavedRange(data.gear_used)}`;
  meta.appendChild(saved);

  box.hidden = false;
}

function showAnswerError(message) {
  const err = $("answer-error");
  $("answer").hidden = true;
  err.textContent = message;
  err.hidden = false;
}

function wireAnswer() {
  const btn = $("ask-btn");
  btn.addEventListener("click", async () => {
    const prompt = $("prompt").value.trim();
    if (prompt === "") {
      showAnswerError("Type a prompt first.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Asking\u2026";
    try {
      const data = await postAnswer(base, {
        prompt,
        mode: shifter.mode(),
        protectedMode: $("protected").checked,
      });
      renderAnswer(data);
    } catch (e) {
      showAnswerError(e.message || "Something went wrong.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Ask";
    }
  });
}

// ---- first-run guide ----
let guideIndex = 0;

function renderGuideCard() {
  const card = GUIDE_CARDS[guideIndex];
  $("guide-title").textContent = card.title;
  $("guide-body").textContent = card.body;
  const dots = document.querySelectorAll("#guide .dots i");
  dots.forEach((d, i) => d.setAttribute("data-active", i === guideIndex ? "true" : "false"));
  $("guide-next").textContent = guideIndex === GUIDE_CARDS.length - 1 ? "Done" : "Next";
}

function openGuide() {
  guideIndex = 0;
  renderGuideCard();
  const overlay = $("guide");
  overlay.setAttribute("data-open", "true");
  $("guide-next").focus();
}

function closeGuide() {
  $("guide").setAttribute("data-open", "false");
  setItem(GUIDE_SEEN_KEY, true);
  $("how-btn").focus();
}

function wireGuide() {
  $("guide-next").addEventListener("click", () => {
    if (guideIndex < GUIDE_CARDS.length - 1) {
      guideIndex += 1;
      renderGuideCard();
    } else {
      closeGuide();
    }
  });
  $("guide-skip").addEventListener("click", closeGuide);
  $("how-btn").addEventListener("click", openGuide);
  // Keyboard dismiss + arrow nav inside the dialog.
  $("guide").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeGuide();
    } else if (e.key === "ArrowRight") {
      if (guideIndex < GUIDE_CARDS.length - 1) {
        guideIndex += 1;
        renderGuideCard();
      }
    } else if (e.key === "ArrowLeft") {
      if (guideIndex > 0) {
        guideIndex -= 1;
        renderGuideCard();
      }
    }
  });
}

// ---- hand-off from the content script ----
function applyHandoff(payload) {
  const h = parseHandoff(payload);
  if (!h) return;
  $("prompt").value = h.prompt;
  selectPosition(h.position);
  // Prefill + preselect, focus Ask, but do NOT auto-send.
  $("ask-btn").focus();
}

function wireRuntimeMessages() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (isOpenMessage(msg)) applyHandoff(msg);
    });
  }
}

// ---- boot ----
async function boot() {
  wireShifter();
  wireAnswer();
  wireGuide();
  wireRuntimeMessages();

  // Resolve the engine base URL.
  const queryApi = readQueryApi(window.location.search);
  let storedApi = null;
  try {
    storedApi = await getItem(API_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  base = resolveBase({ queryApi, storedApi });

  // Hand-off on open.
  try {
    const pending = await takePending();
    if (pending) applyHandoff(pending);
  } catch {
    /* ignore */
  }

  // First-run guide.
  try {
    const seen = await getItem(GUIDE_SEEN_KEY);
    if (!seen) openGuide();
  } catch {
    /* ignore */
  }

  // Connect the stream.
  setConnection("connecting");
  connectStream(base, {
    onEvent: handleEvent,
    onStatus: setConnection,
  });

  renderGrid();
}

boot();

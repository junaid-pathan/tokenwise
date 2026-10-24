# Downshift side panel (PR B8)

Owner: B / Junaid. The extension UI: an H-pattern **gear shifter** (the hero), an
answer view, a grid light + Grid Alert banner, the Narrator line, and a 3-card
first-run guide.

No build step. Plain HTML/CSS/JS **ES modules**. MV3 pages forbid inline scripts,
so every behaviour lives in an external `.mjs`/`.js` file.

## Files

### Pure logic (DOM-free, unit-tested with `node:test`)
| File | What |
| --- | --- |
| `gears.mjs` | Gear names/descriptors copied from `contracts/gears.json`; `relative_energy` table; grid level words/colours. |
| `shifter.mjs` | Shifter state machine: Auto + gears 1–5, arrow/Home/End navigation, mode string. |
| `energy.mjs` | "Wh saved" range estimator + answer-energy formatter. |
| `reducer.mjs` | Folds WS events into `{ level, load_mw, narrator }`; banner/level helpers. |
| `backoff.mjs` | Exponential reconnect backoff with jitter. |
| `config.mjs` | Base-URL resolution (`?api=` → storage → default) and URL builders. |
| `handoff.mjs` | Normalises the content-script hand-off payload. |
| `guide.mjs` | First-run card copy (data only). |

### Thin glue (touch DOM / chrome / network)
| File | What |
| --- | --- |
| `net.mjs` | `connectStream()` (WS + reconnect) and `postAnswer()` (`POST /v1/answer`). |
| `storage.mjs` | `chrome.storage.local` with a `localStorage` fallback; reads/clears the hand-off key. |
| `panel.js` | Entry module; wires the DOM to the logic. Loaded as `type="module"`. |
| `index.html` / `panel.css` | Markup + dark glass theme. |

### Tests
`*.test.mjs`. Run with no install:
```
node --test extension/src/panel/*.test.mjs
```
41 tests, all passing (shifter, energy, reducer, backoff, config, handoff).

## Engine connection
- Default base `http://localhost:8000`; WS `ws://localhost:8000/v1/stream`.
- Override order: **`?api=` query param** → `chrome.storage.local["downshift_api"]` → default.
  Testing uses `?api=http://localhost:8010`.
- Tracks the latest `grid.state` (level word + colour dot + load MW) and the
  latest `narrator.line`. Red → **Grid Alert** banner; Yellow → softer note.
- Reconnects with exponential backoff (500 ms → 15 s cap, ±25% jitter). On close
  it shows a clear **"Engine offline"** state.
- Any event with `synthetic: true` is labelled **"(Simulated)"** in the UI.

## Answer view
`POST {base}/v1/answer` with `{ prompt, mode, protected }` where `mode` is the
shifter output (`"auto"` or `"gear N"`). Renders `{text, gear_used, model,
latency_ms, energy_j, energy_source}` as the answer plus chips: gear name +
number, latency, measured/estimated energy, and the estimated Wh-saved range.
Errors (offline, HTTP error, unreadable body) show plain-language messages.

> The A8 answer endpoint may not be merged yet. This was built against the
> contract in `contracts/api.md` and verified against a stub engine.

## Estimated Wh saved (method)
Users never see "model" or "tokens". We show "saved **about X–Y Wh** (estimated)".

1. `gears.mjs` holds a documented, dimensionless `relative_energy` weight per
   gear (Quick 0.02 … Heavy 0.6 … Max 1.0) that scales roughly with model
   size/cost. **These are not measurements.**
2. We anchor Heavy (the baseline, `BASELINE_GEAR = 4`) to `BASELINE_WH = 3.0` Wh
   for a typical answer, so the **ratio** between gears carries the meaning.
3. Wh saved = `estimate(Heavy) − estimate(chosen gear)`, clamped ≥ 0 (choosing
   Heavy or Max saves ~0 vs the baseline).
4. We present a **range of ±30%** and always label it **"estimated"**. Values
   are rounded by magnitude so we never imply false precision.
5. **If `contracts/gears.json` `est_wh_per_1k_out_tokens` becomes non-null** and
   an output-token count is available, `energy.mjs` prefers that real figure.

## Accessibility
- **Shifter** is a `role="radiogroup"` of `role="radio"` buttons with a roving
  tabindex. Arrow keys (Left/Right/Up/Down) move + select, Home/End jump to the
  ends, Space/Enter select. Visible focus rings (`:focus-visible`, 3px).
- **Live regions:** a polite `role="status"` region announces grid-level changes
  and each Narrator line; the banner is `role="alert" aria-live="assertive"` so a
  Red alert announces immediately.
- **Colour is never the only signal:** the grid level always shows as a word
  (Green / Yellow / Red / Engine offline) next to the colour dot.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables all
  transitions/animations, the selected-gear lift, and the dot glow.
- **Zoom / narrow:** the layout reflows; the shifter grid works at 360px popup
  width and at 200% zoom.
- The first-run dialog is `role="dialog" aria-modal="true"`, dismissible with
  Escape/Skip, navigable with Left/Right, and remembered in storage.

### Contrast ratios (WCAG, computed)
Background `#0b0f14`, card surface `#161d26`. AA needs 4.5:1 (text) / 3:1 (UI).

| Pair | Ratio | Pass |
| --- | --- | --- |
| Body text `#f2f6fb` on bg | 17.71:1 | AAA |
| Muted text `#aeb8c4` on bg | 9.57:1 | AAA |
| Body text on card `#161d26` | 15.63:1 | AAA |
| Muted text on card | 8.44:1 | AAA |
| Green `#22c55e` on bg | 8.43:1 | AA/UI |
| Yellow `#eab308` on bg | 10.02:1 | AA/UI |
| Red `#ef4444` on bg | 5.11:1 | AA |
| Focus ring `#7cc4ff` on bg | 10.25:1 | AA/UI |
| Alert text `#ffd7d7` on red wash | 12.25:1 | AAA |
| Button text `#ffffff` on `#2563eb` | 5.17:1 | AA |

Every key pair meets or exceeds WCAG AA.

## Hand-off contract for Aru's content script (A9)
The content script opens the panel with a prompt in **either** of two ways. The
panel reads it on open, prefills the textarea, preselects the suggested gear, and
focuses the **Ask** button — it never auto-sends.

**(a) Storage key** `downshift_pending` in `chrome.storage.session` (preferred)
or `chrome.storage.local`:
```js
chrome.storage.session.set({
  downshift_pending: { prompt: "write a haiku", gear_suggested: 2, ts: Date.now() }
});
```
The panel reads and then **clears** this key.

**(b) Runtime message** (for a panel that is already open):
```js
chrome.runtime.sendMessage({ type: "downshift.open", prompt: "write a haiku", gear_suggested: 2 });
```

`gear_suggested` may be a number `1–5`, `"gear N"`, `"auto"`, or a gear name
(`"Standard"`); anything unrecognised falls back to Auto. If `chrome.*` is
undefined (plain-page preview), hand-off is simply skipped.

## Surface: popup vs Chrome side panel
`extension/manifest.json` (**JOINT — not edited here**) sets
`action.default_popup = "src/panel/index.html"`, so the panel works today as a
**360px popup**. The same page also works at any width as a **Chrome side panel**.

To open it as a *real* side panel (persisting across tabs, opened by the toolbar
button), the manifest needs changes. **Do not edit `manifest.json` here** — raise
a joint `contract:` PR with this diff:

```diff
   "permissions": ["activeTab", "storage"],
+  "permissions": ["activeTab", "storage", "sidePanel"],
   ...
   "action": { "default_title": "Downshift" },
+  "side_panel": { "default_path": "src/panel/index.html" },
+  "background": { "service_worker": "src/background.js" }
```
with a `src/background.js` (Person A's surface) that calls
`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. Removing
`default_popup` is optional; if both `default_popup` and `side_panel` are set,
the popup wins on action click, so for a true side panel drop `default_popup`.

## What was verified
Unit tests (no install): `node --test extension/src/panel/*.test.mjs` → **41/41
pass** (shifter, energy, reducer, backoff, config, handoff).

Real-browser check with **Playwright (pinned 1.48.2)** + **headless Chromium
(SwiftShader)**, panel served statically on `:5180`, pointed at a throwaway
synthetic stub engine via `?api=`. Verified by looking at screenshots:

- **Hero shifter** renders the H-pattern (Auto + Quick/Light/Standard/Heavy/Max)
  at 360px popup width and at a wide (520px) side-panel width.
- **Grid light + banner:** stream drives Green → Yellow → **Red**; at Red the
  grid light shows the **word "Red"** (+ colour dot + "24,180 MW") and the
  **Grid Alert** banner appears. Synthetic events are labelled **"(Simulated)"**.
- **Narrator line** renders and announces.
- **Keyboard-only shifter:** 3× ArrowDown from Auto selects **Standard (Gear 3)**
  with a visible focus ring; `aria-checked` tracks selection.
- **Answer flow (keyboard):** type prompt → focus Ask → Enter → answer renders
  with chips: gear name+number, latency, energy (measured/estimated), and the
  estimated Wh-saved range.
- **First-run guide:** shows on first load, all 3 cards walk by keyboard
  (Enter/arrows), closes on Done and is remembered.
- **Reduced motion:** with `emulateMedia({reducedMotion:'reduce'})` the `.gear`
  `transition-duration` computes to **0s** (all animation disabled).
- **200% zoom** and **360px width** both reflow without clipping.
- **Engine offline:** pointed at a dead port, the grid light settles on a
  stable **"Engine offline"** (sticky across silent background reconnects — it
  does not flap back to "Connecting").
- **Accessibility snapshot** (`page.accessibility.snapshot`): **no missing
  names/roles** on the first-run dialog or the main view.

### Not verified
Loading as a **real unpacked Chrome extension** (exercising `chrome.sidePanel`,
`chrome.storage.session/local`, and the content-script hand-off end-to-end) was
**not** done here. Those `chrome.*` paths degrade gracefully on a plain page and
are covered by unit tests (`handoff`) and the stub/preview checks; the live
`chrome.*` wiring with Aru's content script remains to be exercised in Chrome.

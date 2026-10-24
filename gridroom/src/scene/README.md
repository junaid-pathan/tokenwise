# gridroom/src/scene — the 3D Grid Room (PR B7)

An "Ember-style" city in real 3D: Massachusetts towns as a tinted floor, three
illustrative data-center towers, and sparks that fly from a prompt's town to the
nearest tower each time a route is decided.

## Component contract (FIXED — App.tsx depends on it)

```ts
export default function Scene({ events }: { events: DownshiftEvent[] })
```

- `events` is the most recent **<= 200** bus events in arrival order (App.tsx
  owns the single `ws://localhost:8000/v1/stream` connection and slices to 200).
- `grid.load` and `grid.state` arrive ~8/s each during a replay, so the window
  rolls over quickly. The Scene **must not** rebuild on every render.
- The Scene fills its parent (`position: absolute; inset: 0`). Aru's 2D HUD is
  drawn on top; the canvas never steals the HUD's layout.

## Event handling rules

All per-event state lives in `effects.ts` (`EventProcessor`), which is a plain
class with **no React/three imports** so it is unit-testable in Node.

- **Dedup**: every event is processed exactly once, keyed by `event.id`
  (bounded `Set`, oldest pruned at 4096). Re-renders never re-trigger effects.
- **Per-event work happens outside render**: the React layer feeds events into
  the processor inside a `useEffect`; the resulting effects mutate **refs** and
  a spark **queue**, which `useFrame` drains. No per-frame React state updates.
- **`prompt.received`** → learn `prompt_id -> town` (bounded map, 4096). Town is
  normalised to the canonical centroid name; unknown/missing towns resolve to
  the default **Boston** (also tries a case-insensitive name match first).
- **`route.decided`** → fire a spark from the prompt's town to the **nearest**
  tower. `deferred: true` routes are **skipped** (queued, not flown). Orphan
  routes (no matching `prompt.received`) fall back to Boston.
- **`grid.state`** → update the floor-tint level (and the a11y live region).
- **`power.sample`** → update the smoothed watts driving tower glow/height.

## Colours (hard-coded — we do NOT import gears.json at runtime)

| Use | Colour |
| --- | --- |
| Floor tint — green level | `#22c55e` |
| Floor tint — yellow level | `#eab308` |
| Floor tint — red level | `#ef4444` |
| Spark — full power (`gear_used >= gear_needed`) | amber `#f59e0b` |
| Spark — downshifted (`gear_used < gear_needed`) | green `#22c55e` |

Two signal colours only for sparks. The floor tint is a **dim** version of the
level colour (lerped) so tiles stay dark and readable — it is a floor tint, not
neon. Colour is never the only signal for the grid level: a visually-hidden
`aria-live` region announces "Grid level <level>" and the wrapper's `aria-label`
updates too (the HUD shows the level as a word as well).

## Data

- `data/ma-towns.json` — merged into ONE `BufferGeometry` (`groundGeometry.ts`)
  so all 351 towns are a single draw call.
- `data/town-centroids.json` — `{ "Town Name": [lon, lat] }` for every town.
  The crowd simulator (B6, Python) should pick towns from this file so the scene
  always knows where to start a spark. See `data/README.md` for provenance and
  the mapshaper command (MassGIS attribution).

## Projection

`projection.ts` — `lonLatToXZ(lon, lat)`: equirectangular around the MA centre
(`STATE_CENTER`) with a `cos(lat)` longitude correction, scaled by
`PROJECTION_SCALE`. State centre maps to the origin; east is `+x`, north is `-z`
(map reads north-up). Pure, unit-tested.

## Motion & accessibility

- **Motion only when something changes.** No idle spin/bob loops. Sparks animate
  only while in flight; tower glow/height change only when watts change.
- **`prefers-reduced-motion`**: arc travel is skipped (the spark shows a brief
  static marker near the tower, `t ≈ 0.92`) and tower height pulsing is disabled
  (glow intensity still changes).
- Canvas wrapper has `role="img"` + an `aria-label` describing the scene and the
  current grid level, plus a visually-hidden `aria-live="polite"` region.

## Performance

- Orthographic camera, `dpr={[1, 1.5]}`.
- Ground = 1 merged geometry = **1 draw call**. Towers = 3 meshes + 3 `Text`.
  Sparks = **1 instanced mesh** (pool of 512, ring-buffer reuse). Bloom adds a
  few post passes. Approx **~12–16 draw calls** total for the whole scene,
  independent of event rate.
- Geometries are disposed on unmount (`Ground` and `Sparks` cleanup effects).

## Demo controls (PR B9)

Press these keys in the Grid Room window (ignored while typing in a text field,
on key repeat, and with Ctrl/Alt/Cmd held). A short toast confirms each one.

| Key | Does | Engine call |
| --- | --- | --- |
| `R` | Replay June 24, 2025 at the current speed | `POST /v1/demo/replay` |
| `1` / `2` / `3` | Replay at slow (24 h in 6 min) / normal (3 min) / fast (90 s) | `POST /v1/demo/replay` |
| `A` | Toggle a Grid Alert: red, or back to green if already red | `POST /v1/demo/alert` |
| `X` | Reset: grid to green, sparks cleared, camera and speed back to default | `POST /v1/demo/alert {green}` |

`X` cannot stop a replay that is already running. There is no stop endpoint, and
adding one needs a joint `contract:` PR. Press `R` to restart the replay instead.

The key logic is pure and unit-tested in `demo.ts` / `demo.test.ts`.

## Polish (PR B9)

- **Camera push-in**: while the grid is red, the orthographic frustum eases from
  16 to 11 (zooming toward the state centre) and eases back out after. Under
  `prefers-reduced-motion` it snaps instead of animating.
- **Tower glow**: each tower flashes when a spark lands on it, decaying over
  about a quarter second, on top of the existing watts-driven glow.
- **"Simulated" labels**: bottom-right tags appear whenever the current event
  window contains simulated crowd prompts, replayed grid load, or estimated
  power (`simulatedFlag` in `demo.ts`). Live data shows no tag. A key legend
  sits under them.

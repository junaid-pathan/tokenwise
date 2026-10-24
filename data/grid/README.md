# data/grid/ — owner B (Junaid), PR B1

June 24, 2025 hourly New England (ISO-NE) **demand** pulled from the EIA API v2,
cached here as `june24.json` and interpolated to per-minute points by the replay
clock in `engine/replay`.

## Files
- `fetch_eia.py` — fetches the 24 hourly points from EIA and writes `june24.json`.
- `june24.json` — the cached curve + provenance metadata. **The replay runs
  entirely offline from this file**; no network call at replay time.

## How to refetch
You need a free EIA API key (instant by email) in `.env` as `EIA_API_KEY`
(loaded with python-dotenv). The key is secret and is never printed, logged, or
written to the cache.

```powershell
# from the repo root, using the shared venv
$env:PY="C:\Users\user\Documents\sip\.venv\Scripts\python.exe"
& $env:PY data/grid/fetch_eia.py --dry-run   # fetch + print summary, no write
& $env:PY data/grid/fetch_eia.py             # fetch + overwrite june24.json
```

`data/grid/*.json` is git-ignored until PR #12 merges, so the cache was committed
with `git add -f data/grid/june24.json`.

EIA endpoint used:
`https://api.eia.gov/v2/electricity/rto/region-data/data/`
with facets `respondent=ISNE` (ISO New England), `type=D` (demand),
`frequency=hourly`, `data[0]=value`.

## Timezone handling (important)
The replay runs on **local New England time** (`America/New_York`), which on
2025-06-24 is **EDT = UTC-4**. EIA `period` timestamps are in **UTC**.

So the local day `2025-06-24 00:00 .. 2025-06-25 00:00` (EDT) corresponds to the
UTC window `2025-06-24 04:00 .. 2025-06-25 04:00`. The fetch script requests that
UTC window, converts every period to local time, and keeps the 24 points whose
local hour falls on 2025-06-24 (local hours 00..23). Each cached point is
labelled with its local clock string (e.g. `2025-06-24T19:00:00`), matching the
`replay_clock` field in `contracts/fixtures/grid.load.json`.

## The peak found (honesty check)
The **true maximum demand in the EIA data is 25,898 MW at local hour 19:00
(7 PM EDT)**.

The PRD expected a peak near 26,586 MW in the afternoon. The real data is about
688 MW lower (~2.6%) and peaks in the early evening, not mid-afternoon. **The
data was NOT adjusted or rescaled** — the cache is the raw EIA values. The curve
still comfortably crosses the red threshold (23,500 MW), so the afternoon/evening
goes red as the demo requires.

Level progression the interpolated curve produces (Aru's Grid agent thresholds:
green ≤ 20,000 MW, yellow ≤ 23,500 MW, red above):

| local clock | load_mw | level |
| --- | --- | --- |
| 2025-06-24T00:00:00 | 19,715 | green |
| 2025-06-24T11:48:00 | 20,001 | yellow |
| 2025-06-24T15:47:00 | 23,511 | red |
| 2025-06-24T22:22:00 | 23,492 | yellow |
| 2025-06-24T23:54:00 | 19,980 | green |

Peak 25,898 MW at 19:00. (The late dip back to green comes from interpolating
the final hour toward the next day's 00:00 value.)

## Interpolation & replay
`engine/replay/interpolate.py` linearly interpolates the 24 hourly values to
1,440 per-minute values (minute 0 == hour 0 exactly; each whole-hour minute
equals its hourly value). `engine/replay/__init__.py` publishes one `grid.load`
event per replay minute via `POST /v1/demo/replay {date, speed}`.

`speed` = replay **seconds per real second** (default 480 → 24 h in 3 real
minutes). One replay minute takes `60/speed` real seconds. Pacing is
drift-corrected (each deadline is `start + k * interval` from a monotonic start),
so the clock never drifts.

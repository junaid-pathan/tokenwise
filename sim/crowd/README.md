# sim/crowd/ — owner B (Junaid), PR B6

Simulated users in Massachusetts towns replay the held-out prompts so the whole
Downshift loop has traffic. **Rate follows the replay load. Every prompt is truly
routed by Aru's Triage + Coordinator; 1 in 10 is truly generated, the rest use
estimated energy.** Target: **200 prompts per replay hour** through A's Triage and
Coordinator. Everything here is **"Simulated"** — label it as such in any UI.

## How it works

An outside process cannot publish onto the engine's in-process bus (there is no
inbound endpoint), so the crowd is an **engine-style module** exposing
`register(bus, app)`, exactly like `engine.agents.*`. It wires two bus
subscriptions and owns no HTTP route.

Lifecycle:

- **Inert until `grid.load` flows.** The crowd starts and stops purely from the
  bus — merely registering it does nothing until a replay runs.
- **Env switch `CROWD_SIM=0`** (or `false`/`no`/`off`) disables it entirely:
  `register()` returns `None` and subscribes nothing.

On each `grid.load` (the replay emits one per replay minute, field `load_mw`) the
crowd:

1. measures the **real wall-clock interval** since the previous `grid.load`
   (so it self-paces at *any* replay speed — see the rate section),
2. draws a **Poisson** count of prompts for that replay minute from the load,
3. schedules that many `prompt.received` emissions, each **jittered** uniformly
   over the measured real interval, each from a population-weighted MA town
   carrying a held-out prompt.

Each simulated user emits:

```json
{"type": "prompt.received", "prompt_id": "crowd-<n>", "source": "crowd",
 "chars": <len(prompt)>, "town": "<MA town>"}
```

`prompt.received` carries `chars`, **not** the prompt text. Aru's Triage therefore
classifies the crowd path by **length buckets** (`classify_from_event`), emits
`triage.decided`; her Coordinator emits `route.decided` (`gear_used`, possibly
downshifted one gear when the grid is red). We subscribe to `route.decided` **for
our own `prompt_id`s only** and emit `answer.completed` so the Coordinator's
`coordinator.report` accounting works:

```
prompt.received → triage.decided → route.decided → answer.completed
                                                 → coordinator.report / utility.*
```

Foreign `route.decided` events (extension/api prompts) are ignored.

## Rate formula (follows the replay load)

```
REFERENCE_MW          = 21,000 MW   (the day's approximate average NE demand)
TARGET_PER_REPLAY_HOUR = 200
base_per_minute       = 200 / 60 = 3.3333

expected_per_minute(load_mw) = base_per_minute * (load_mw / REFERENCE_MW)   # LINEAR
count_this_minute            = Poisson(expected_per_minute(load_mw))
```

The rate scales **linearly** with load. The June-24 replay peaks near 26,586 MW,
so peak minutes emit ~27% more than the reference minute and quiet overnight
minutes emit fewer. Over a full 1440-minute day the per-minute means sum to
`200 * (daily_mean / REFERENCE_MW)`, i.e. ≈200 per replay hour on average when
`REFERENCE_MW` is the true daily mean.

**Self-pacing at any speed.** The emissions for a replay minute are spread over
the *real* time until the next `grid.load`, which we measure live. At the default
replay speed (480 replay s per real s) one replay minute takes `60/480 = 0.125`
real seconds, so at 21,000 MW that is ≈27 prompts per real second. At the test
speed 14400 it is 30× faster. We never block the event loop: emissions are
`asyncio` tasks that only `await asyncio.sleep`, and in-flight work is capped
(`_MAX_INFLIGHT_EMISSIONS`, `_MAX_INFLIGHT_ANSWERS`) so memory stays bounded; a
`grid.load` gap longer than 10 s is treated as a fresh start, not a real interval.

## Towns

Population-weighted MA towns (bigger cities more often), canonical Title Case.

- **If `gridroom/src/scene/data/town-centroids.json` exists**, we use its keys so
  a prompt's town matches the Grid Room scene and can be drawn as a spark. Those
  keys are weighted by our built-in population table where known, else a small
  uniform default.
- **Otherwise** we fall back to a built-in list of **50 real MA towns** with
  approximate 2020-census populations as weights (`towns.MA_TOWN_POP`).

We **never** emit a town outside the list we actually loaded.

## Energy estimate table (9 in 10 answers)

9 of 10 crowd answers report `energy_source: "estimated"`. There is no live GPU
meter on the crowd path, and `est_wh_per_1k_out_tokens` in `contracts/gears.json`
is `null` until the Hardware gate. Until then we estimate joules from a simple,
**honestly-approximate (NOT measured)** table keyed on gear, derived from model
size — bigger model, more energy per answer — so the Coordinator's savings
accounting always has a monotonic, defensible signal (downshifting a gear always
saves energy). These are **placeholders**.

| gear | model (Ollama)        | est. J / ~64-token answer |
| ---- | --------------------- | ------------------------- |
| 1    | qwen2.5:0.5b          | 20                        |
| 2    | llama3.2:1b           | 40                        |
| 3    | llama3.2:3b           | 120                       |
| 4    | llama3.1:8b           | 320                       |
| 5    | Bedrock-only (no Ollama) | 900                    |

Joules scale linearly with output length relative to the 64-token reference:
`joules = base[gear] * output_tokens / 64`.

**If `gears.json` later carries a non-null `est_wh_per_1k_out_tokens`, we prefer
it:** `joules = wh_per_1k * (output_tokens / 1000) * 3600`.

## Real generation (1 in 10)

Every 10th prompt is truly generated off the event loop
(`asyncio.to_thread(realgen.generate_real, gear_used, prompt)`) for gears 1-4 via
Aru's `engine.llm.ollama.generate` against the Colab tunnel (`OLLAMA_URL` from
`.env`, loaded by python-dotenv). **Gear 5 has no Ollama model, so it stays
estimated.** The Colab tunnel may be **down** — any failure or timeout **falls
back to the estimate and is counted** (`stats["real_fallback"]`). On success we
report the real `latency_ms` / `output_tokens`, and if a live power meter covers
the window `engine.power.energy_between(t0, t1)` may return `"measured"` energy;
otherwise the estimate is used.

If Aru's answer-endpoint PR (#17) later exposes a clean in-process generate
function, the real ones could route through it behind a lazy optional import;
today it only registers an HTTP route, so we call `engine.llm.ollama` directly
behind a lazy import.

**Security:** this module never prints or logs `OLLAMA_URL` or any secret; backend
errors are summarised to a short class name only.

## Known limitation

The crowd path is triaged by **prompt length only** (`prompt.received` carries
`chars`, not text), so its gear mix differs from the held-out B3 labels. This is
expected and documented, not a bug.

## How to enable it in the engine (joint contract: PR)

`engine/app.py` is frozen/joint. This PR touches **no contracts**. A one-line
follow-up **joint `contract:` PR** adds the module to `engine/app.py`'s `MODULES`
list so the live engine registers the crowd on startup:

```python
MODULES = [
    ...
    "engine.agents.narrator",
    "sim.crowd",            # B6: simulated MA-town users (this follow-up line)
    "engine.mock_stream",
]
```

Until that line lands, call `sim.crowd.register(bus, app)` explicitly (the
integration test and `run_integration.py` do exactly this).

## Run / verify

From the worktree root with the shared venv:

```powershell
$py = "C:\Users\user\Documents\sip\.venv\Scripts\python.exe"

# unit + behaviour tests (fast, no engine import)
& $py -m pytest sim/crowd/test_units.py sim/crowd/test_behavior.py -q

# real-engine integration report (boots engine.app, runs a ~6 s replay)
& $py -m sim.crowd.run_integration 14400

# same flow as a gated pytest
$env:RUN_CROWD_INTEGRATION = "1"; & $py -m pytest sim/crowd/test_integration.py -q
```

## Files

- `__init__.py` — `register(bus, app)`, the `CrowdSim` loop, pacing, loop-closing.
- `towns.py` — population-weighted MA town picker (centroids file or built-in 50).
- `prompts.py` — held-out prompt loader (`training/data/heldout.jsonl`, 200 rows).
- `rate.py` — the linear-load Poisson rate model (formula above).
- `energy.py` — the estimate table + `gears.json` override.
- `realgen.py` — the 1-in-10 real-generation helper (fails safe to estimate).
- `test_units.py`, `test_behavior.py`, `test_integration.py` — the tests.
- `run_integration.py` — prints the full measured report.
- `conftest.py` — forces pytest-asyncio auto mode for this package.

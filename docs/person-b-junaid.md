# Person B — Junaid (supply side)

You own the **supply side**: the grid replay, the negotiating Utility, the
Narrator, the crowd, the 3D scene, and the side panel. In the 4-hour cut you ship
~5 PRs. Build against the mock + fixtures so you never wait on Aru.

## Setup (once, ~5 min)
```powershell
cd C:\Users\user\Documents\sip
git config core.hooksPath .githooks
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env    # add EIA_API_KEY; leave POWER_SOURCE=estimate
# sanity: see the demo loop with no code yet
$env:DOWNSHIFT_MOCK=1; uvicorn engine.app:app --port 8000
```
Grid Room: `cd gridroom; npm install; npm run dev` → http://localhost:5173

## Your folders (edit ONLY these)
`data/grid`, `engine/replay`, `engine/llm/bedrock.py`, `engine/agents/utility`,
`engine/agents/narrator`, `training/data`, `sim/`, `extension/src/panel`,
`gridroom/src/scene`

Never touch `contracts/`, `engine/app.py`, `engine/bus.py`.

## How to plug in
Every module you own already has a `register(bus, app)` stub. Fill it in:
```python
def register(bus, app):
    state = {"reds": 0}
    async def on_grid_state(ev):
        if ev["level"] == "red":
            state["reds"] += 1
            if state["reds"] == 2:
                await bus.publish({"type": "utility.request",
                    "request_id": "r-1", "cut_pct": 25.0,
                    "duration_min": 120, "reason": "grid red for 2 samples"})
        else:
            state["reds"] = 0
    bus.subscribe("grid.state", on_grid_state)

    @app.post("/v1/utility/request")
    async def req(body: dict): ...
```
Event shapes are frozen in `contracts/events.py`. Use those exact field names.

## Your PRs, in order (4-hour cut)

### 1. `b/grid-replay`
Pull June 24, 2025 hourly New England demand from the EIA API (free key), cache
to `data/grid/june24.json`, interpolate to minutes. Replay clock in
`engine/replay` emits `grid.load` on a timer; serve `POST /v1/demo/replay`
`{date, speed}` (default 24h in 3 min). **4h shortcut:** if EIA fights you, hard-code
~12 hourly points peaking near 26,586 MW and interpolate those.
**Done when:** a 3-min replay peaks near 26,586 MW and Aru's Grid agent turns it red.

### 2. `b/utility-agent`
Deterministic negotiator in `engine/agents/utility`. Subscribe `grid.state`:
red for 2 samples in a row → emit `utility.request` (25% cut, 120 min). Subscribe
`coordinator.report` → emit `utility.verdict` (accept, or if shortfall > 3 pts
re-request once with escalation). Serve `POST /v1/utility/request` so a company
can request a cut too.
**Done when:** against the fixture commit/report events, it accepts or flags a shortfall.

### 3. `b/crowd-sim`
Simulated users in MA towns (`sim/crowd`) replay `training/data/heldout.jsonl`
prompts. Rate follows the replay load (busier when load is high). Emit
`prompt.received` with a `town`. Every prompt truly routed; 1 in 10 truly
generated, rest estimated. Target ~200 prompts per replay hour. Label UI "Simulated".
**Done when:** prompts flow through Aru's Triage + Coordinator and show as sparks.

### 4. `b/narrator`
Narrator in `engine/agents/narrator`. Template lines first (one per 8 s, 18 words
max) on `coordinator.commit` / `coordinator.report` / `utility.verdict` /
level changes → emit `narrator.line`. If AWS is ready, swap in Bedrock lines via
`engine/llm/bedrock.py` with the number guard (every number must appear in the
cited events, else fall back to the template).
**Done when:** a bad number in a line is caught and replaced by a template.

### 5. `b/gridroom-scene` + `b/extension-panel`
Scene in `gridroom/src/scene`: Massachusetts floor that tints green→red with
`grid.state`, three labelled "illustrative" towers, sparks (arcs) on each
`route.decided` (amber full-power, green downshifted), isometric camera. Panel in
`extension/src/panel`: grid-light icon + Grid Alert banner + latest narrator line,
connecting to `ws://localhost:8000/v1/stream`.
**Done when:** a real `route.decided` shows up as a spark; the panel shows the grid light.

## Data hand-off to Aru (do early, ~by hour 1:30 in the 4h cut)
Write `training/data/heldout.jsonl` (200 held-out prompts) first — the crowd sim
and (if built) the quality check use only these. If you build the full classifier
path, also write `train.csv` (prompt,gear). In the 4h cut Aru runs rules-only, so
`heldout.jsonl` for the crowd sim is the must-have.

## If you finish early
Full EIA live feed, Bedrock Narrator, the full crowd-sim energy accounting, demo
keys (R replay, A alert, 1-3 speed, X reset), or the OpenAI-compatible endpoint
(`/v1/chat/completions`) — coordinate in chat so only one of you builds it.

## Review duty
You review Aru's PRs within 15 min: check contracts untouched, run the row's
"Done when", confirm the proof is attached. Squash merge, delete the branch.

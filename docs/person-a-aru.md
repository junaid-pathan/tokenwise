# Person A — Aru (demand side)

You own the **demand side**: deciding gears, routing, answering, and the HUD.
In the 4-hour cut you ship ~5 PRs. Build against the mock + fixtures so you never
wait on Junaid.

## Setup (once, ~5 min)
```powershell
git clone https://github.com/junaid-pathan/sip.git; cd sip
git config core.hooksPath .githooks
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env    # leave POWER_SOURCE=estimate
# sanity: see the demo loop with no code yet
$env:DOWNSHIFT_MOCK=1; uvicorn engine.app:app --port 8000
# in another shell: curl http://localhost:8000/health
```
Grid Room: `cd gridroom; npm install; npm run dev` → http://localhost:5173

## Your folders (edit ONLY these)
`colab/`, `engine/power`, `engine/llm/ollama.py`, `engine/api`, `engine/metrics`,
`engine/agents/triage`, `engine/agents/grid`, `engine/agents/coordinator`,
`training/model`, `training/eval`, `extension/src/content`, `gridroom/src/hud`

Never touch `contracts/`, `engine/app.py`, `engine/bus.py`.

## How to plug in
Every module you own already has a `register(bus, app)` stub. Fill it in:
```python
def register(bus, app):
    async def on_grid_load(ev):               # ev is a plain dict
        level = level_for(ev["load_mw"])      # green/yellow/red
        await bus.publish({"type": "grid.state", "load_mw": ev["load_mw"],
                           "level": level, "replay_clock": ev["replay_clock"],
                           "source": ev["source"]})
    bus.subscribe("grid.load", on_grid_load)

    @app.get("/v1/grid")
    async def get_grid(): ...                 # latest grid.state
```
Event shapes are frozen in `contracts/events.py`. Use those exact field names.

## Your PRs, in order (4-hour cut)

### 1. `a/grid-agent`
Grid levels from load. Green < 20,000 MW, yellow <= 23,500, red above (tune so
June 24 afternoon goes red). Subscribe `grid.load` → emit `grid.state` every
replay minute. Serve `GET /v1/grid` (latest state) and `POST /v1/demo/alert`
`{level}` for a manual demo alert.
**Done when:** Junaid's 3-min replay goes green → yellow → red → green on `/v1/stream`.

### 2. `a/triage-rules`
Rules-only Triage (skip the trained model in 4h). Subscribe `prompt.received`,
pick the lowest gear that answers well (arithmetic/short = 1, summarize/extract =
2, writing/simple code = 3, reasoning/real code = 4, hard math/architecture = 5)
→ emit `triage.decided` with `confidence` + `reason`. Serve `POST /v1/triage`
`{prompt}` → `{gear, confidence, label, reason}` in under 150 ms.
**Done when:** "what's 15% of 80" returns Gear 1; a crowd prompt gets a gear on the stream.

### 3. `a/coordinator`
Deterministic policy (PRD table). Subscribe `triage.decided` + `grid.state` →
emit `route.decided` (one gear down when red and confidence >= 0.6, floor Gear 1;
never shift protected). Then negotiation: on `utility.request`, predict the cut,
escalate if short, emit `coordinator.commit`, then `coordinator.report` every
~30 replay-seconds (baseline vs actual joules from `answer.completed`).
**Done when:** Junaid's crowd prompts shift one gear down when red; Utility gets a commit + report.

### 4. `a/answer-endpoint`
`POST /v1/answer` in `engine/api`: route (respect `mode` auto/gear N and
`protected`), call `engine.llm.generate(gear, prompt)` (stub/ollama), read energy
via `engine.power.energy_between` (estimate is fine), emit `answer.completed`.
**Done when:** Junaid's side panel shows an answer with a joules number.

### 5. `a/gridroom-hud` + `a/scorecard`
HUD in `gridroom/src/hud`: wattmeter (from `power.sample`), load curve with a
playhead (from `grid.load`), scorecard panel (from `scorecard.update`),
negotiation log + narrator ticker. And `engine/metrics`: subscribe
`answer.completed`, compute joules/answer, quality match %, p50 latency, No
Downshift vs Downshift → emit `scorecard.update`.
**Done when:** HUD sits over Junaid's 3D scene and the numbers move during a replay.

## If you finish early
Add the trained classifier (A4 full: embeddings + logreg on Junaid's `train.csv`),
the real Colab power meter (A1/A2 + Hardware gate — STOP and do it jointly), or
the extension content script (A9).

## Review duty
You review Junaid's PRs within 15 min: check contracts untouched, run the row's
"Done when", confirm the proof is attached. Squash merge, delete the branch.

# Person A — Aru (demand side)

You own the demand side: gears, routing, answering, power, the extension content
script, and the HUD. **12 PRs, full PRD scope.** Build against `DOWNSHIFT_MOCK=1`
and `contracts/fixtures/` so you never wait on Junaid. Run 2 Kiro agents in
parallel in separate worktrees (one per row, never the same folder).

## Setup (once, ~5 min)
```powershell
git clone https://github.com/junaid-pathan/sip.git; cd sip
git config core.hooksPath .githooks
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # POWER_SOURCE=estimate until the Hardware gate
$env:DOWNSHIFT_MOCK=1; uvicorn engine.app:app --port 8000   # see the demo loop
```
Also install Ollama, then `ollama pull qwen2.5:0.5b` and `ollama pull llama3.2:1b`.
Grid Room: `cd gridroom; npm install; npm run dev` -> http://localhost:5173

## Your folders (edit ONLY these)
`colab/`, `engine/power`, `engine/llm/ollama.py`, `engine/api`, `engine/metrics`,
`engine/agents/{triage,grid,coordinator}`, `training/model`, `training/eval`,
`extension/src/content`, `gridroom/src/hud`.
Never touch `contracts/`, `engine/app.py`, `engine/bus.py`.

## How to plug in
Each module has a stub `register(bus, app)`. Subscribe with `bus.subscribe(type, async_handler)`,
publish with `await bus.publish({...})`, add routes on `app`. Event field names are
frozen in `contracts/events.py`.

## Your PRs (branch from latest main, in this order)

| PR | Branch | What it does | Done when | Min |
| --- | --- | --- | --- | --- |
| A1 | `a/colab-host` | Colab notebook in `colab/`: Ollama with Gears 1-4, cloudflared tunnel, small endpoint serving `nvidia-smi` power | A Gear 1 answer comes back from Colab through the tunnel | 40 |
| A2 | `a/power-meter` | `engine/power`: poll Colab power at 2 Hz, idle baseline, `energy_between(t0,t1)`, emit `power.sample`, estimate fallback | Live watts on the stream. Then the Hardware gate. | 30 |
| A3 | `a/ollama-client` | `engine/llm/ollama.py` calling the Colab tunnel URL from `.env` | `llm.generate(1, ...)` returns text | 10 |
| A4 | `a/triage-classifier` | Rules fallback serving `/v1/triage` first (~20 min in), then MiniLM embeddings + logistic regression trained on B's labels, swapped in behind a flag | Within-one-gear accuracy >= 85% on B's labels, under 150 ms | 65 |
| A5 | `a/grid-agent` | Levels/thresholds tuned on B's replay, live EIA feed for "now", `/v1/grid`, `/v1/demo/alert` | B's 3-min replay goes green, yellow, red, green | 30 |
| A6 | `a/coordinator-policy` | Policy table, protected prompts, deferral queue, emits `route.decided` | B's crowd prompts shift one gear down when the grid is red | 30 |
| A7 | `a/coordinator-negotiation` | Handles `utility.request`: predict, escalate, commit, report | B's Utility agent gets a commit and reports, and returns a verdict | 30 |
| A8 | `a/answer-endpoint` | `POST /v1/answer`: route, generate, read energy, emit `answer.completed` | B's side panel shows an answer with a measured joules number | 25 |
| A9 | `a/extension-content` | Content script on chatgpt.com + claude.ai: read composer, call `/v1/triage`, gear badge, Grammarly-style underline "This is a Gear 1 question. Shift down?", shorter-answer nudge, opens B's side panel | Typing "what's 15% of 80" shows Gear 1 and opens B's panel | 60 |
| A10 | `a/scorecard` | `engine/metrics`: joules/answer, quality match %, p50 latency, No Downshift vs Downshift | Numbers update live during a replay | 20 |
| A11 | `a/gridroom-hud` | `gridroom/src/hud`: wattmeter, load curve + playhead, scorecard panel, negotiation log, narrator ticker | HUD sits over B's 3D scene and moves during a replay | 30 |
| A12 | `a/quality-eval` | 100 of B's held-out prompts, chosen gear vs Gear 5, judged via B's Bedrock client, writes match % | Scorecard shows the quality number | 20 |

### Rules that matter per row
- **Agents (PRD table):** Triage <150 ms on CPU, picks lowest gear that answers well. Grid: green < 20,000 MW, yellow to 23,500, red above; tune so June 24 goes red in the afternoon peak; emit `grid.state` every replay minute. Coordinator: deterministic, never touches protected prompts.
- **Coordinator policy:** Green = triage gear (deferrable runs now). Yellow = triage gear (deferrable held up to 30 min). Red or active cut = one gear down if confidence >= 0.6, floor Gear 1 (deferrable held until green, then released gradually; protected never shifted).
- **Cut request:** predict the cut from the last 5 min of traffic; if short, shift Gear 2-3 down two gears; commit the smaller of predicted/requested; report every 30 replay-seconds using real `answer.completed` energy vs counterfactual baseline.
- **Classifier (A4):** until B's labels land (~Hardware gate), train on 100 hand-labelled prompts. Features: `all-MiniLM-L6-v2` embeddings + length, digit ratio, code markers, question words. Multinomial logreg, 5-fold CV, save with joblib. Load once at engine start; if the model file is missing, fall back to rules.
- **Quality eval (A12):** without Bedrock, hand-check 30 pairs and label it "hand-checked, n=30".
- **Extension look (A9):** dark glass, 5-gear H-pattern hero, one accent colour per grid level, users never see "model" or "tokens" (Quick/Light/Standard/Heavy/Max, "saved about X Wh" as a range). Keyboard reachable, ARIA labels, colour never the only signal, AA contrast.

## Hardware gate (with Junaid, ~T+1:10, right after A2 merges)
STOP. Nobody picks a power source alone. In Colab: (1) `nvidia-smi --query-gpu=power.draw --format=csv -l 1`
shows watts; (2) answer the same 20 prompts with `qwen2.5:0.5b` and `llama3.1:8b`;
(3) pass if 8B uses >= 3x joules per answer, readings are steady, tunnel round trip < 500 ms.
Then set the source in `.env` and fill `est_wh_per_1k_out_tokens` in `contracts/gears.json`
via one joint `contract:` PR. Fallbacks: Kaggle T4, MX450 local, labelled estimates.

## Review duty
Review Junaid's PRs within 15 min: contracts untouched, run the row's "Done when",
proof attached. Squash merge, delete the branch.

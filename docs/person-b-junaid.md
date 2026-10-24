# Person B — Junaid (supply side)

You own the supply side: grid data and replay, Bedrock, training data, the Utility
and Narrator agents, the crowd, the 3D scene, and the side panel. **9 PRs (two
large), full PRD scope.** Build against `DOWNSHIFT_MOCK=1` and `contracts/fixtures/`
so you never wait on Aru. Run 2 Kiro agents in parallel in separate worktrees.

## Setup (once, ~5 min)
```powershell
git config core.hooksPath .githooks
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # add EIA_API_KEY + AWS creds; POWER_SOURCE=estimate
$env:DOWNSHIFT_MOCK=1; uvicorn engine.app:app --port 8000
```
Also install Ollama and pull `qwen2.5:0.5b`, `llama3.2:1b`. Grid Room: `cd gridroom; npm install; npm run dev`.

## Your folders (edit ONLY these)
`data/grid`, `engine/replay`, `engine/llm/bedrock.py`, `engine/agents/{utility,narrator}`,
`training/data`, `sim/`, `extension/src/panel`, `gridroom/src/scene`.
Never touch `contracts/`, `engine/app.py`, `engine/bus.py`.

## Your PRs (branch from latest main, in this order)

| PR | Branch | What it does | Done when | Min |
| --- | --- | --- | --- | --- |
| B1 | `b/grid-replay` | Pull June 24, 2025 hourly New England demand from EIA, interpolate to minutes, replay clock in `engine/replay` emitting `grid.load`, `POST /v1/demo/replay` (default 24 h in 3 min) | A 3-min replay peaks near 26,586 MW and A's Grid agent turns it into levels | 45 |
| B2 | `b/bedrock-client` | `engine/llm/bedrock.py` with Converse API: Gear 5, labelling, quality judge, Narrator. Falls back to A's Colab models | One call returns text | 25 |
| B3 | `b/training-data` | Collect + label ~2,000 prompts. Write 200 held-out to `training/data/heldout.jsonl` FIRST, labels to `train.csv` by the Hardware gate | A's classifier trains on these labels | 40 |
| B4 | `b/utility-agent` | Cut request on sustained red, verdict on reports, one escalation, `POST /v1/utility/request` | Against fixture commit/report events, it accepts or flags a shortfall | 30 |
| B5 | `b/narrator` | Template lines first, then Bedrock lines with the number guard, 1 line per 8 s | A bad number in a line is caught and replaced by a template | 35 |
| B6 | `b/crowd-sim` | Simulated MA-town users replay held-out prompts; rate follows replay load; every prompt truly routed, 1 in 10 truly generated, rest estimated energy | 200 prompts per replay hour flow through A's Triage and Coordinator | 45 |
| B7 | `b/gridroom-scene` | `gridroom/src/scene`: 3D Massachusetts tiles, data-center towers, sparks from the stream | A real prompt from A's extension shows up as a spark | 90 |
| B8 | `b/extension-panel` | `extension/src/panel`: H-pattern gear shifter, answer view, grid-light icon, Grid Alert banner, Narrator line, 3-card first-run guide | A's badge opens it and it answers; keyboard-only works; respects reduced motion | 60 |
| B9 | `b/polish-demo` | Tower glow, camera push-in on alert, "Simulated" labels, demo keys R (replay), A (alert), 1-3 (speed), X (reset) | Full demo resets and replays without touching code | 30 |

### Rules that matter per row
- **Utility:** deterministic. Red for 2 samples in a row -> request 25% cut for 120 replay minutes. Shortfall over 3 points -> re-request once with escalation.
- **Narrator:** one line per 8 s, 18 words max. Every number must appear in the events it cites, otherwise use a template line.
- **Labels (B3):** sample `databricks/databricks-dolly-15k`, `openai/gsm8k`, and `mbpp`. Label gears 1-5 with the Gears table rubric: Claude Haiku 20 prompts/call returning JSON (~100 calls), else heuristic labels from category, length, math/code markers.
- **Scene (B7):** Vite + React + `@react-three/fiber` + drei + postprocessing bloom. Orthographic isometric camera. MassGIS town boundaries simplified with mapshaper to under 1 MB (fallback: hex-tile map). Three towers at Holyoke, Westfield, Lowell labelled "illustrative"; glow/height pulse with live watts. Each `route.decided` fires an instanced arc from the user's town to a tower (amber full power, green downshifted). Floor tints green->red with `grid.state`. Two signal colours only; motion only when something changes.
- **Panel (B8):** keyboard reachable, ARIA labels, colour never the only signal (level also shown as a word), AA contrast.

## AWS checklist (start NOW; it runs in the background)
- [ ] Ask the AWS sponsor at the event for an event account/credits first (may replace this list)
- [ ] Account + $20 billing alarm, region `us-east-1`
- [ ] Bedrock model catalog: enable Nova Micro/Lite/Pro, Claude Haiku/Sonnet (Anthropic asks a one-time use-case form)
- [ ] IAM user limited to `bedrock:InvokeModel` + `bedrock:Converse`, or a Bedrock API key, into `.env` only
- [ ] Copy exact model IDs into `contracts/gears.json` (joint `contract:` PR; current IDs are placeholders)
- [ ] One Converse call from B2 returns text
- [ ] Get a free EIA API key (instant by email) for B1

## Hardware gate (with Aru, ~T+1:10)
STOP 10 min together after A2 merges. Hand over `heldout.jsonl` + `train.csv`. See Aru's doc for the test.

## Review duty
Review Aru's PRs within 15 min: contracts untouched, run the row's "Done when",
proof attached. Squash merge, delete the branch.

# PLAN.md — the 4-hour cut-list

The PRD is scoped for 8 hours and 21 PRs. We have **4 hours and two people**.
This file is the ruthless cut: we ship the **90-second demo loop** and nothing
that doesn't serve it. Everything here is already scaffolded in Phase 0, so both
of you start writing real code immediately.

## What we are actually shipping (the demo loop)
1. June 24 replay drives load up → Grid agent turns it **red**.
2. Crowd sim fires real prompts → Triage gears them → sparks in the Grid Room.
3. Utility asks for a 25% cut → Coordinator commits + reports → Utility verdict.
4. Scorecard shows joules/answer + quality kept. Narrator speaks each step.

## What we CUT (do not build in 4h)
- Colab GPU host + real nvidia-smi power meter → **use `estimate` source** (`POWER_SOURCE=estimate`).
- Trained classifier (embeddings + logreg) → **rules-only Triage**. (A4 rules path only.)
- Extension content script on live ChatGPT/Claude → **side-panel-only demo**.
- Quality eval via Bedrock judge → **hand-labelled number, n=10**, if time.
- OpenAI-compatible `/v1/chat/completions`, App Runner deploy, Kaggle fallback.
- Real Bedrock for answers → **stub/Ollama-local or estimated text is fine** for the loop; use Bedrock only for Narrator lines if AWS is ready, else template lines.

## Time budget (4 hours = 240 min). Hour 0 = now.

| Time | Both / A (Aru) | B (Junaid, you) |
| --- | --- | --- |
| 0:00–0:10 | Enable hooks, `pip install`, `npm install`, read your doc | same |
| 0:10–1:30 | **A-grid** (grid levels + /v1/grid + /v1/demo/alert), **A-triage-rules** (prompt.received → triage.decided + /v1/triage) | **B-replay** (grid.load from a cached June-24 curve + /v1/demo/replay), **B-utility** (red-twice → request; report → verdict) |
| 1:30–1:40 | **Milestone 1 "first spark"** (joint 10-min check, see milestones.md) | same |
| 1:40–3:00 | **A-coordinator** (policy → route.decided; request → commit + report), **A-answer** (/v1/answer → answer.completed) | **B-crowd-sim** (prompts follow load → prompt.received), **B-narrator** (template lines on commit/report/verdict) |
| 3:00–3:15 | **Milestone 2 "first negotiation"** (turn off mock, run one real replay) | same |
| 3:15–3:50 | **A-hud** (wattmeter, load curve, scorecard panel, negotiation log) + **A-scorecard** (metrics → scorecard.update) | **B-scene** (MA floor tint by grid.state, towers, sparks on route.decided) + **B-panel** (grid light + narrator line) |
| 3:50–4:00 | **Rehearse** the 90s demo, record a backup video, submit | same |

Each side is ~5 real PRs. Branch from latest `main` every time. If a piece
slips, drop it to its fallback (see the CUT list) rather than blocking the loop.

## Reduced PR list (branch names)

### A — Aru (demand side), in order
- `a/grid-agent` — grid.load → level → grid.state; `/v1/grid`, `/v1/demo/alert`
- `a/triage-rules` — prompt.received → triage.decided (rules); `POST /v1/triage`
- `a/coordinator` — policy → route.decided; utility.request → commit → report
- `a/answer-endpoint` — `POST /v1/answer` → answer.completed (energy via estimate)
- `a/gridroom-hud` + `a/scorecard` — HUD panels + metrics → scorecard.update

### B — Junaid (supply side), in order
- `b/grid-replay` — cached June-24 curve → grid.load; `POST /v1/demo/replay`
- `b/utility-agent` — red-twice → utility.request; report → utility.verdict; `POST /v1/utility/request`
- `b/crowd-sim` — prompts follow replay load → prompt.received (with `town`)
- `b/narrator` — template lines on commit/report/verdict/level-change
- `b/gridroom-scene` + `b/extension-panel` — 3D floor/towers/sparks + panel grid light

## Hard rules while we move fast
- Never edit `contracts/`, `engine/app.py`, `engine/bus.py`. They're frozen.
- Build against `DOWNSHIFT_MOCK=1` and `contracts/fixtures/` so you never wait on the other person.
- One branch per row from latest `main`. Squash merge. The other person reviews in <15 min.
- Keep the `estimate` power source. No Hardware gate in 4h.
- Commit style: lowercase verb + thing, <=50 chars. No AI co-author lines (hook enforces).

## Definition of done for the hackathon
`DOWNSHIFT_MOCK=0`, one real replay: grid goes red, Utility requests, Coordinator
commits + reports, Utility accepts, scorecard + narrator update, Grid Room shows
it. That's the submission. Everything else is bonus.

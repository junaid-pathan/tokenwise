# Downshift

Puts AI in the right gear: small models for easy prompts, big ones only when
needed, and everything shifts down a gear when the grid is stressed.

Hackachusetts 2026 · Track 3 Climate Tech.

## The loop
A prompt gets a gear → the grid gets stressed → five agents negotiate a cut →
the Grid Room proves the savings live.

## Repo layout
```
contracts/   FROZEN: gears.json, events.py, events.ts, api.md, fixtures/
engine/      FastAPI engine: app.py (joint), bus.py (joint), agents, llm, power
colab/       GPU host notebook (A)
training/    classifier model + eval (A), data + labels (B)
sim/         crowd simulator (B)
extension/   browser extension: content (A), panel (B)
gridroom/    3D Grid Room: hud (A), scene (B)
data/        grid data cache (B)
.kiro/ .githooks/ .github/   joint tooling
```

## Run the engine (mock mode — no agents needed yet)
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DOWNSHIFT_MOCK=1; uvicorn engine.app:app --port 8000
```
Then open `ws://localhost:8000/v1/stream` (or run the Grid Room) to see the demo
loop replay from `contracts/fixtures/scenario.demo.json`.

Health check: `GET http://localhost:8000/health`.
Preview the mock sequence without a server: `python -m engine.mock_stream --print`.

## Run the Grid Room
```powershell
cd gridroom; npm install; npm run dev   # http://localhost:5173
```

## Planning docs
- `PLAN.md` — the 4-hour cut-list and who does what
- `docs/person-a-aru.md` — Aru's tasks (demand side)
- `docs/person-b-junaid.md` — Junaid's tasks (supply side)
- `docs/milestones.md` — the two joint checkpoints

## Rules
One PRD row = one branch = one PR. Branch from latest `main`. Edit only your
owned folders. Never touch `contracts/`, `engine/app.py`, `engine/bus.py` without
a joint `contract:` PR. No AI co-author lines (enforced by `.githooks/commit-msg`).
Enable hooks once per laptop: `git config core.hooksPath .githooks`.

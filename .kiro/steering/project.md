# Downshift rules for agents
- Read the PRD row you were given. Its "Done when" is your acceptance test.
- Edit ONLY folders your owner owns (see PRD "Team split"). Never edit contracts/, engine/app.py, engine/bus.py.
- Talk to other components only through contracts/ events and API. Missing something? Mock it and tell the human.
- Commits: lowercase verb + thing, 50 chars max. Never add Co-authored-by or "Generated with" lines.
- One branch per PRD row, created from latest main.
- At the Hardware gate, STOP and ask both humans. Do not choose a power source.
- Label anything simulated as "Simulated" in the UI.

## Owners
- Person A = Aru (demand side): colab/, engine/power, engine/llm/ollama.py, engine/api, engine/metrics, engine/agents/{triage,grid,coordinator}, training/model, training/eval, extension/src/content, gridroom/src/hud
- Person B = Junaid (supply side): data/grid, engine/replay, engine/llm/bedrock.py, engine/agents/{utility,narrator}, training/data, sim/, extension/src/panel, gridroom/src/scene

## Ports & env
- Engine 8000, Grid Room 5173. CORS allows chrome-extension://* and localhost:5173.
- Secrets live in .env (never committed). See .env.example.
- Before real agents exist, run the engine with DOWNSHIFT_MOCK=1 to replay contracts/fixtures/scenario.demo.json on the bus.

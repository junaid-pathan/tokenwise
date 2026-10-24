# ⛏️ TokenWise

**The trick isn't using less AI. It's using the *right* AI.**

Every question you ask AI uses electricity, and most of us send everything to
the biggest model. TokenWise sorts each question into one of five gears (like
Minecraft pickaxes, Wood → Netherite), tells you the right-size model, answers
the easy ones itself, and shows the energy and CO₂ you saved.

Hackachusetts 2026 · Track 3: Climate Tech · Team: Aru (demand side) and Junaid (supply side)

---

## The problem
- AI data centers are one of the fastest-growing users of electricity.
- Most prompts are simple ("what's 15% of 80?"), but they still go to the largest, most power-hungry model.
- Users never see the energy cost, so they have no reason to choose differently.

## What TokenWise does

### 1. The claude.ai sidebar (browser extension)
Opens by itself on every new chat.

| Feature | What you see |
| --- | --- |
| **⛏️ Five gears** | Every question is sorted live as you type: Quick, Light, Standard, Heavy, Max (Wood, Stone, Iron, Diamond, Netherite pickaxes). |
| **Right model** | "You're on Opus. **Switch to Haiku**: ~80% less energy." It also says when a question *needs* the big model. |
| **⚡ Answer it here** | Easy questions skip Claude entirely: math is solved in the browser, other questions go to a tiny AI on our own GPU, with energy **measured live**. |
| **✂ Shorter prompt** | Grammarly for tokens: removes ALL CAPS, filler ("could you please kindly…"), "!!!!", repeated words. One click to use the shorter version. |
| **💡 Your impact** | Running total of energy saved (as lightbulb time), CO₂ kept out of the air, and questions answered without Claude. |
| **Your AI footprint** | Questions asked, % sent to the right model, energy used, CO₂ caused. |

### 2. The engine (FastAPI, grid-aware)
- **Triage:** a trained classifier (MiniLM embeddings + logistic regression, 87% within one gear on held-out prompts) plus keyword rules for hard cases.
- **Coordinator:** routes each prompt to a gear and **shifts down a gear when the power grid is stressed** (red), never touching protected prompts.
- **Grid agent + utility negotiation:** the grid asks for a power cut, the coordinator commits to one and reports what it actually saved.
- **Power meter:** reads real GPU watts from our Colab T4 and integrates energy per answer.

### 3. The Grid Room (live simulation)
A voxel Holyoke, MA world that replays a real grid-stress day (June 24, 2025). Every prompt, real and simulated, sparks on the map, and the HUD shows the grid level, wattmeter, and the before vs after scorecard.

## How it works
```
claude.ai ──► TokenWise sidebar ──► background worker ──► engine (localhost:8000)
                 │                                          ├─ Triage (classifier)  → gear 1-5
                 │                                          ├─ Coordinator (grid-aware routing)
                 │                                          ├─ /v1/answer → tiny model on Colab GPU
                 │                                          └─ Power meter (real watts)
                 └─ instant: rules, calculator, Tighten     │
                                                            ▼
                                            WebSocket stream → Grid Room + popup panel
```

## Honest numbers
| Number | Source |
| --- | --- |
| Tiny-AI energy per answer | **Measured** on our Colab T4 GPU |
| Haiku / Sonnet / Opus energy (the "~80% less") | **Estimate**: 0.24 Wh median prompt, scaled by relative API price (≈ 1 : 3 : 5). Anthropic doesn't publish per-model energy. |
| Lightbulb time | 10 W LED: 1 Wh = 6 minutes of light |
| CO₂ | ≈ 0.25 g per Wh (New England grid) |
| Token savings | Approximate tokenizer-style count |
| The crowd in the Grid Room | Simulated (labelled "Simulated" on screen) |

## Run it
**1. Engine**
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env     # add the Colab OLLAMA_URL and POWER_URL
uvicorn engine.app:app --port 8000
```
Health check: http://localhost:8000/health

**2. GPU (optional, for "Answer it here")**
Run `colab/sip_colab.ipynb` on a Colab T4 and paste the printed `OLLAMA_URL` and `POWER_URL` into `.env`, then restart the engine.

**3. Extension**
`chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension/` folder. Open https://claude.ai/new.

**4. Grid Room**
```powershell
cd gridroom; npm install; npm run dev   # http://localhost:5173
```
Keys: **R** replay · **3** fast replay · **A** grid alert · **X** reset.

## Try these prompts
| Prompt | Gear | TokenWise says |
| --- | --- | --- |
| `2+2` | ⛏️ Wood | Use Haiku, or answer it here instantly |
| `what is the capital of France` | ⛏️ Wood | Answer it here with the tiny GPU model |
| `HEY CLAUDE!!!!! CAN YOU PLEASE HELP ME WRITE AN EMAIL TO MY BOSS ASAP?????` | ✂ | 66% shorter prompt |
| `debug this: my React component re-renders forever when I call setState in useEffect` | 💎 Diamond | Use Sonnet |
| `If the multiverse is real, is there another me out there?` | 🔥 Netherite | Use Opus |

## Tech stack
Python · FastAPI · scikit-learn · sentence-transformers · Ollama (qwen2.5, llama3.x) on Colab T4 · AWS Bedrock · Chrome MV3 extension · React + Vite + Three.js · WebSockets

## Repo layout
```
extension/   claude.ai sidebar (content/) + popup panel (panel/)
engine/      FastAPI engine: agents (triage, coordinator, grid, utility, narrator), llm, power, api
training/    classifier model, labels, quality eval
gridroom/    voxel Grid Room (scene + HUD)
sim/         simulated crowd of Massachusetts users
colab/       GPU host notebook (Ollama + power meter + tunnels)
contracts/   shared event schemas and gear table
```

## What's next
- Measured per-model energy from providers instead of estimates.
- One-line drop-in for companies: an OpenAI-compatible endpoint (`model: tokenwise-auto`) so every request is right-sized automatically.
- ChatGPT and Gemini support in the extension.

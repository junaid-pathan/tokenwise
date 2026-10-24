# training/data/ — owner B (Junaid), PR B3

Collect + label ~2,000 prompts for the Downshift gear classifier. Delivered:

- `heldout.jsonl` — 200 held-out prompts, one JSON object per line
  `{"prompt": ..., "source": ..., "gear": N}`. The crowd simulator (B6) and the
  quality check use **only** these. Written first, disjoint from `train.csv`.
- `train.csv` — columns `prompt,gear`, 1,794 rows (no overlap with heldout).

Gears follow the `contracts/gears.json` `typical_prompt` rubric:

| gear | user sees | typical prompt |
| --- | --- | --- |
| 1 | Quick | a fact, a sum, a one-line rewrite |
| 2 | Light | short explanation, summarize, extract |
| 3 | Standard | multi-paragraph writing, simple code |
| 4 | Heavy | multi-step reasoning, real code |
| 5 | Max | hard math, architecture, long constrained writing |

## Sources (public Hugging Face datasets)

| source | dataset | sampled | notes |
| --- | --- | --- | --- |
| dolly | `databricks/databricks-dolly-15k` | 1,294 | all 8 task categories, instruction text |
| gsm8k | `openai/gsm8k` (config `main`) | 450 | grade-school math word problems |
| mbpp | `google-research-datasets/mbpp` (config `full`) | 250 | small Python coding tasks |

Note: the bare `mbpp` alias no longer resolves on `datasets==3.1.0` (it needs a
namespaced repo id), so `build_dataset.py` loads `google-research-datasets/mbpp`
with fallbacks. This is the same MBPP data, just the canonical namespaced repo.

## Label source: Claude Haiku (Bedrock)

Labels were produced in two stages:

1. **Heuristic labeller** (`build_dataset.py`) writes the files immediately from
   dolly category + prompt length + math/code/architecture markers, so the
   deliverables exist even without Bedrock.
2. **Claude Haiku refinement** (`label.py`) then relabelled every prompt via the
   Bedrock Converse API, 20 prompts per call returning JSON.
   - model `us.anthropic.claude-haiku-4-5-20251001-v1:0`, region `us-east-2`
   - **100 Converse calls** (hard cap 150), **1,994 / 1,994 rows relabelled by Haiku**,
     0 kept heuristic.
   - Credentials read from `.env` (`AWS_BEARER_TOKEN_BEDROCK`) via python-dotenv.
     Secret values are never printed, logged or committed.

Final label source: **Haiku** (all rows). See `label_report.json` for the machine
report. If Bedrock had been unavailable, `label.py` keeps the heuristic labels and
the report would say so.

## Gear distribution

`heldout.jsonl` (200): `{1: 62, 2: 66, 3: 61, 4: 9, 5: 2}`
`train.csv` (1,794):  `{1: 570, 2: 709, 3: 422, 4: 85, 5: 8}`

Haiku judges difficulty by the task itself, so gsm8k/mbpp prompts land mostly in
gears 1-3 (they are genuinely easy for a strong model) and gears 4-5 stay sparse.
The distribution spans all five gears but is skewed low; if the classifier needs
more gear 4/5 examples, add harder math/code/architecture sources and re-run.

## Reproduce

Run from the worktree root `C:\\Users\\user\\Documents\\ds-b3` with the shared venv:

```powershell
$py = "C:\Users\user\Documents\sip\.venv\Scripts\python.exe"
# 1. sample + heuristic labels -> writes heldout.jsonl then train.csv
& $py training\data\build_dataset.py
# 2. refine labels with Claude Haiku (needs AWS_BEARER_TOKEN_BEDROCK in .env)
& $py training\data\label.py
# 3. sanity check
& $py training\data\check_data.py
```

Sampling is seeded (`SEED=20260`) so `build_dataset.py` is deterministic.

## Files

- `build_dataset.py` — sample the three datasets, heuristic labels, write files.
- `label.py` — Haiku refinement via Bedrock Converse (batch 20, cap 150 calls).
- `check_data.py` — sanity checks (200 heldout, no dups/overlap, gears 1-5, non-empty).
- `label_report.json` — label source + call count + gear distribution.

## Note on .gitignore

The repo `.gitignore` currently ignores `training/data/*.csv` and `*.jsonl` (not
owned by this PR, left unchanged). The deliverables were committed with
`git add -f training/data/heldout.jsonl training/data/train.csv`.

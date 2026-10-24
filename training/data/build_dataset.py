"""Build the Downshift gear-classifier dataset.

Samples prompts from three public Hugging Face datasets:
  - databricks/databricks-dolly-15k  (8 task categories, general prompts)
  - openai/gsm8k                     (grade-school math word problems)
  - mbpp                             (small Python coding tasks)

Each prompt is given a heuristic gear label (1..5) following the rubric in
contracts/gears.json typical_prompt:
  1 Quick    - a fact, a sum, a one-line rewrite
  2 Light    - short explanation, summarize, extract
  3 Standard - multi-paragraph writing, simple code
  4 Heavy    - multi-step reasoning, real code
  5 Max      - hard math, architecture, long constrained writing

Outputs (written to this directory):
  - heldout.jsonl : 200 held-out prompts  {"prompt","source","gear"}
  - train.csv     : ~1,800 prompts        columns: prompt,gear

The held-out set is written FIRST and is disjoint from train.csv.

Run (from C:\\Users\\user\\Documents\\ds-b3):
  C:\\Users\\user\\Documents\\sip\\.venv\\Scripts\\python.exe training\\data\\build_dataset.py
"""
from __future__ import annotations

import csv
import json
import random
import re
from pathlib import Path

from datasets import load_dataset

HERE = Path(__file__).resolve().parent
HELDOUT_PATH = HERE / "heldout.jsonl"
TRAIN_PATH = HERE / "train.csv"

SEED = 20260              # deterministic sampling
TARGET_TOTAL = 2000
HELDOUT_N = 200

# ---------------------------------------------------------------------------
# Heuristic labeller
# ---------------------------------------------------------------------------

# Dolly categories map to a rough baseline gear.
DOLLY_CATEGORY_GEAR = {
    "open_qa": 2,
    "closed_qa": 2,
    "classification": 1,
    "information_extraction": 2,
    "summarization": 2,
    "brainstorming": 3,
    "creative_writing": 3,
    "general_qa": 2,
}

CODE_MARKERS = re.compile(
    r"\b(function|def |class |algorithm|implement|code|program|script|"
    r"return|array|list|string|loop|recursion|sort|compile|debug|"
    r"api|regex|sql|query)\b",
    re.IGNORECASE,
)
MATH_MARKERS = re.compile(
    r"[0-9].*[-+*/x=]|\b(sum|times|divide|multiply|percent|how many|how much|"
    r"total|average|remainder|equation|solve|calculate)\b",
    re.IGNORECASE,
)
ARCH_MARKERS = re.compile(
    r"\b(architecture|design a|system design|scalable|distributed|trade-?offs?|"
    r"microservices?|optimi[sz]e|prove|theorem|derive)\b",
    re.IGNORECASE,
)
ONELINE_REWRITE = re.compile(
    r"\b(rewrite|rephrase|correct|fix the|capitali[sz]e|translate this word|"
    r"convert|what is the capital|who is|when did|what year)\b",
    re.IGNORECASE,
)


def word_count(text: str) -> int:
    return len(text.split())


def heuristic_gear(prompt: str, source: str, category: str | None) -> int:
    """Return a gear 1..5 from cheap signals: source, category, length, markers."""
    p = prompt.strip()
    wc = word_count(p)

    # --- source-driven defaults -------------------------------------------
    if source == "gsm8k":
        # Grade-school math word problems: multi-step reasoning with numbers.
        # Short ones -> gear 4, long/multi-sentence -> gear 5.
        sentences = p.count(".") + p.count("?")
        if wc >= 60 or sentences >= 4:
            return 5
        return 4

    if source == "mbpp":
        # Real Python coding tasks. Simple one-liners -> 3, otherwise 4.
        if wc <= 14 and not CODE_MARKERS.search(p):
            return 3
        if ARCH_MARKERS.search(p) or wc >= 40:
            return 4
        return 4 if CODE_MARKERS.search(p) else 3

    # --- dolly -------------------------------------------------------------
    base = DOLLY_CATEGORY_GEAR.get(category or "", 2)

    # strong overrides
    if ARCH_MARKERS.search(p) and wc >= 25:
        return 5
    if category in ("creative_writing", "brainstorming") and wc >= 40:
        return 4  # longer constrained writing
    if ONELINE_REWRITE.search(p) and wc <= 18:
        return 1
    if CODE_MARKERS.search(p):
        return 4 if wc >= 25 else 3
    if MATH_MARKERS.search(p) and category == "classification":
        return 1

    # length nudges on top of the category baseline
    if wc <= 8:
        base = min(base, 1 if category in ("classification", "closed_qa") else 2)
    elif wc <= 20:
        base = base
    elif wc <= 50:
        base = max(base, 3)
    else:
        base = max(base, 4)

    return max(1, min(5, base))


# ---------------------------------------------------------------------------
# Sampling helpers
# ---------------------------------------------------------------------------

def clean(text: str) -> str:
    return " ".join(text.strip().split())


def sample_dolly(n: int, rng: random.Random) -> list[dict]:
    ds = load_dataset("databricks/databricks-dolly-15k", split="train")
    cats = sorted({r["category"] for r in ds})
    per_cat = max(1, n // len(cats))
    by_cat: dict[str, list[dict]] = {c: [] for c in cats}
    order = list(range(len(ds)))
    rng.shuffle(order)
    for i in order:
        r = ds[i]
        instr = clean(r["instruction"])
        ctx = clean(r.get("context", ""))
        if not instr:
            continue
        cat = r["category"]
        if len(by_cat[cat]) >= per_cat:
            continue
        # Prefer context-free prompts so the classifier sees the instruction.
        prompt = instr if len(instr) >= 12 else (instr + " " + ctx).strip()
        by_cat[cat].append({"prompt": prompt, "source": "dolly", "category": cat})
        if sum(len(v) for v in by_cat.values()) >= n:
            break
    out: list[dict] = []
    for c in cats:
        out.extend(by_cat[c])
    return out[:n]


def sample_gsm8k(n: int, rng: random.Random) -> list[dict]:
    ds = load_dataset("openai/gsm8k", "main", split="train")
    order = list(range(len(ds)))
    rng.shuffle(order)
    out: list[dict] = []
    for i in order[: n * 2]:
        q = clean(ds[i]["question"])
        if q:
            out.append({"prompt": q, "source": "gsm8k", "category": None})
        if len(out) >= n:
            break
    return out


def sample_mbpp(n: int, rng: random.Random) -> list[dict]:
    # This datasets version requires a namespaced repo id ("namespace/name");
    # the bare "mbpp" alias no longer resolves. Try the canonical repo first,
    # then a couple of known mirrors.
    ds = None
    last_err = None
    for repo in ("google-research-datasets/mbpp", "Muennighoff/mbpp", "mbpp"):
        try:
            ds = load_dataset(repo, "full", split="train")
            break
        except Exception as e:  # noqa: BLE001 - try next source
            last_err = e
            try:
                ds = load_dataset(repo, split="train")
                break
            except Exception as e2:  # noqa: BLE001
                last_err = e2
                continue
    if ds is None:
        raise RuntimeError(f"could not load an mbpp source: {last_err}")
    order = list(range(len(ds)))
    rng.shuffle(order)
    out: list[dict] = []
    for i in order[: n * 2]:
        text = clean(ds[i]["text"])
        if text:
            out.append({"prompt": text, "source": "mbpp", "category": None})
        if len(out) >= n:
            break
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def dedupe(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        key = r["prompt"].strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main() -> None:
    rng = random.Random(SEED)

    # Target mix out of ~2000: dolly is the bulk (8 categories, breadth),
    # gsm8k and mbpp add math + code so gears 4/5 are populated.
    n_dolly = 1300
    n_gsm8k = 450
    n_mbpp = 250

    print("loading datasets...")
    dolly = sample_dolly(n_dolly, rng)
    gsm = sample_gsm8k(n_gsm8k, rng)
    mbpp = sample_mbpp(n_mbpp, rng)
    print(f"  dolly={len(dolly)} gsm8k={len(gsm)} mbpp={len(mbpp)}")

    rows = dedupe(dolly + gsm + mbpp)
    rng.shuffle(rows)
    rows = rows[:TARGET_TOTAL]

    # Label every row heuristically.
    for r in rows:
        r["gear"] = heuristic_gear(r["prompt"], r["source"], r.get("category"))

    # --- held-out split FIRST --------------------------------------------
    rng.shuffle(rows)
    heldout = rows[:HELDOUT_N]
    train = rows[HELDOUT_N:]

    # Write heldout.jsonl first.
    with HELDOUT_PATH.open("w", encoding="utf-8", newline="\n") as f:
        for r in heldout:
            f.write(json.dumps(
                {"prompt": r["prompt"], "source": r["source"], "gear": r["gear"]},
                ensure_ascii=False,
            ) + "\n")
    print(f"wrote {HELDOUT_PATH.name}: {len(heldout)} lines")

    # Write train.csv.
    with TRAIN_PATH.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["prompt", "gear"])
        for r in train:
            w.writerow([r["prompt"], r["gear"]])
    print(f"wrote {TRAIN_PATH.name}: {len(train)} rows")

    # --- report -----------------------------------------------------------
    def dist(items):
        d = {g: 0 for g in range(1, 6)}
        for r in items:
            d[r["gear"]] += 1
        return d

    print("heldout gear dist:", dist(heldout))
    print("train gear dist:  ", dist(train))
    srcs = {}
    for r in rows:
        srcs[r["source"]] = srcs.get(r["source"], 0) + 1
    print("source dist:      ", srcs)


if __name__ == "__main__":
    main()

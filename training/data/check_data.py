"""Sanity checks for the Downshift training data.

Verifies:
  - heldout.jsonl has exactly 200 lines
  - no duplicate prompts within or across heldout and train
  - every gear is an integer in 1..5
  - no empty prompts
  - heldout objects have prompt/source/gear keys

Run:
  C:\\Users\\user\\Documents\\sip\\.venv\\Scripts\\python.exe training\\data\\check_data.py
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
HELDOUT_PATH = HERE / "heldout.jsonl"
TRAIN_PATH = HERE / "train.csv"


def main() -> int:
    errors: list[str] = []

    heldout = []
    for ln, line in enumerate(HELDOUT_PATH.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        obj = json.loads(line)
        for k in ("prompt", "source", "gear"):
            if k not in obj:
                errors.append(f"heldout line {ln} missing key {k}")
        heldout.append(obj)

    train = []
    with TRAIN_PATH.open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        if r.fieldnames != ["prompt", "gear"]:
            errors.append(f"train.csv columns are {r.fieldnames}, expected ['prompt','gear']")
        for row in r:
            train.append(row)

    if len(heldout) != 200:
        errors.append(f"heldout has {len(heldout)} lines, expected 200")

    def check_gear(g, where):
        try:
            gi = int(g)
        except (ValueError, TypeError):
            errors.append(f"{where}: gear {g!r} not an int")
            return None
        if not (1 <= gi <= 5):
            errors.append(f"{where}: gear {gi} out of range 1..5")
        return gi

    held_prompts = []
    for i, o in enumerate(heldout):
        p = (o.get("prompt") or "").strip()
        if not p:
            errors.append(f"heldout row {i}: empty prompt")
        held_prompts.append(p.lower())
        check_gear(o.get("gear"), f"heldout row {i}")

    train_prompts = []
    for i, row in enumerate(train):
        p = (row.get("prompt") or "").strip()
        if not p:
            errors.append(f"train row {i}: empty prompt")
        train_prompts.append(p.lower())
        check_gear(row.get("gear"), f"train row {i}")

    # duplicates within each
    for name, lst in (("heldout", held_prompts), ("train", train_prompts)):
        dups = [p for p, c in Counter(lst).items() if c > 1]
        if dups:
            errors.append(f"{name} has {len(dups)} duplicate prompt(s)")

    # overlap across
    overlap = set(held_prompts) & set(train_prompts)
    if overlap:
        errors.append(f"{len(overlap)} prompt(s) overlap between heldout and train")

    # report
    def dist(items, key):
        d = Counter(int(x[key]) for x in items)
        return {g: d.get(g, 0) for g in range(1, 6)}

    print(f"heldout lines: {len(heldout)}")
    print(f"train rows:    {len(train)}")
    print(f"heldout gear dist: {dist(heldout, 'gear')}")
    print(f"train gear dist:   {dist(train, 'gear')}")
    hs = Counter(o.get("source") for o in heldout)
    print(f"heldout source dist: {dict(hs)}")

    if errors:
        print("\nFAILED:")
        for e in errors:
            print("  -", e)
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

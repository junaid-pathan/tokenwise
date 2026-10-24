"""Improve Downshift gear labels with Claude Haiku on Amazon Bedrock.

Reads heldout.jsonl + train.csv (produced by build_dataset.py), asks Claude
Haiku to assign a gear 1..5 to each prompt in batches of 20 returning JSON,
then rewrites both files with the model labels. Heuristic labels are kept for
any prompt the model does not return (or if Bedrock is unavailable).

Rubric given to the model matches contracts/gears.json typical_prompt:
  1 Quick    - a fact, a sum, a one-line rewrite
  2 Light    - short explanation, summarize, extract
  3 Standard - multi-paragraph writing, simple code
  4 Heavy    - multi-step reasoning, real code
  5 Max      - hard math, architecture, long constrained writing

Safety:
  - Credentials come from .env (AWS_BEARER_TOKEN_BEDROCK) via python-dotenv.
  - Secret values are never printed or logged.
  - HARD CAP of 150 Converse calls (user's own paid account).

Run (from C:\\Users\\user\\Documents\\ds-b3):
  C:\\Users\\user\\Documents\\sip\\.venv\\Scripts\\python.exe training\\data\\label.py

It writes a label-source report to label_report.json.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
HELDOUT_PATH = HERE / "heldout.jsonl"
TRAIN_PATH = HERE / "train.csv"
REPORT_PATH = HERE / "label_report.json"

MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
REGION = "us-east-2"
BATCH = 20
HARD_CAP_CALLS = 150

RUBRIC = (
    "You are labelling prompts for an AI router that picks a model size (gear).\n"
    "Assign each prompt an integer gear 1-5 using this rubric:\n"
    "1 Quick: a fact, a sum, a one-line rewrite.\n"
    "2 Light: short explanation, summarize, extract.\n"
    "3 Standard: multi-paragraph writing, simple code.\n"
    "4 Heavy: multi-step reasoning, real code.\n"
    "5 Max: hard math, architecture, long constrained writing.\n"
    'Reply ONLY with a JSON object mapping the given id (as a string) to its '
    'gear, e.g. {"0": 2, "1": 5}. No prose, no code fence.'
)


def load_rows() -> tuple[list[dict], list[dict]]:
    heldout = []
    with HELDOUT_PATH.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                heldout.append(json.loads(line))
    train = []
    with TRAIN_PATH.open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            train.append({"prompt": row["prompt"], "gear": int(row["gear"])})
    return heldout, train


def make_client():
    load_dotenv(HERE.parent.parent / ".env")
    import boto3  # imported here so the file is usable without boto3 for inspection

    region = os.environ.get("AWS_REGION", REGION)
    # The Bedrock API key is read by boto3 from AWS_BEARER_TOKEN_BEDROCK.
    if not os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        raise RuntimeError("AWS_BEARER_TOKEN_BEDROCK not set in environment/.env")
    return boto3.client("bedrock-runtime", region_name=REGION)


def parse_json_obj(text: str) -> dict:
    """Extract the first JSON object from the model text."""
    text = text.strip()
    # strip code fences if present
    text = re.sub(r"^```[a-zA-Z]*\n?|```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def label_batch(client, prompts: list[str]) -> dict[int, int]:
    numbered = "\n".join(f"[{i}] {p}" for i, p in enumerate(prompts))
    resp = client.converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": [{"text": RUBRIC + "\n\nPrompts:\n" + numbered}]}],
        inferenceConfig={"maxTokens": 400, "temperature": 0},
    )
    text = resp["output"]["message"]["content"][0]["text"]
    obj = parse_json_obj(text)
    out: dict[int, int] = {}
    for k, v in obj.items():
        try:
            idx = int(k)
            g = int(v)
        except (ValueError, TypeError):
            continue
        if 0 <= idx < len(prompts) and 1 <= g <= 5:
            out[idx] = g
    return out


def main() -> None:
    heldout, train = load_rows()
    all_rows = heldout + train           # heldout first so it is always labelled
    n = len(all_rows)
    print(f"loaded {len(heldout)} heldout + {len(train)} train = {n} rows")

    # How many batches fit in the cap? Cover as much as possible, heldout first.
    max_rows = HARD_CAP_CALLS * BATCH
    cover = min(n, max_rows)
    print(f"will attempt to relabel {cover} rows in batches of {BATCH} "
          f"(cap {HARD_CAP_CALLS} calls)")

    try:
        client = make_client()
    except Exception as e:  # noqa: BLE001
        print(f"bedrock unavailable, keeping heuristic labels: {type(e).__name__}")
        _write_report("heuristic", 0, 0, n, heldout, train)
        return

    calls = 0
    relabelled = 0
    failures = 0
    i = 0
    while i < cover and calls < HARD_CAP_CALLS:
        batch = all_rows[i:i + BATCH]
        prompts = [r["prompt"] for r in batch]
        calls += 1
        try:
            labels = label_batch(client, prompts)
        except Exception as e:  # noqa: BLE001 - keep heuristic for this batch
            failures += 1
            print(f"  batch {calls} failed ({type(e).__name__}), keeping heuristic")
            if failures >= 3 and relabelled == 0:
                print("  three straight failures with nothing labelled; stopping")
                break
            i += BATCH
            continue
        for j, g in labels.items():
            batch[j]["gear"] = g
            relabelled += 1
        if calls % 10 == 0:
            print(f"  {calls} calls, {relabelled} relabelled")
        i += BATCH

    label_source = "heuristic"
    if relabelled and relabelled >= n // 2:
        label_source = "haiku"
    elif relabelled:
        label_source = "mixed"

    print(f"done: {calls} calls, {relabelled} relabelled by Haiku, "
          f"{n - relabelled} kept heuristic")

    if relabelled:
        _rewrite(heldout, train)
    _write_report(label_source, calls, relabelled, n - relabelled, heldout, train)


def _rewrite(heldout: list[dict], train: list[dict]) -> None:
    with HELDOUT_PATH.open("w", encoding="utf-8", newline="\n") as f:
        for r in heldout:
            f.write(json.dumps(
                {"prompt": r["prompt"], "source": r["source"], "gear": int(r["gear"])},
                ensure_ascii=False,
            ) + "\n")
    with TRAIN_PATH.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["prompt", "gear"])
        for r in train:
            w.writerow([r["prompt"], int(r["gear"])])
    print("rewrote heldout.jsonl and train.csv with updated labels")


def _dist(items):
    d = {g: 0 for g in range(1, 6)}
    for r in items:
        d[int(r["gear"])] += 1
    return d


def _write_report(source, calls, relabelled, heuristic_kept, heldout, train):
    report = {
        "label_source": source,
        "bedrock_model": MODEL_ID,
        "region": REGION,
        "converse_calls": calls,
        "relabelled_by_haiku": relabelled,
        "kept_heuristic": heuristic_kept,
        "heldout_gear_dist": _dist(heldout),
        "train_gear_dist": _dist(train),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("report:", json.dumps(report))


if __name__ == "__main__":
    main()

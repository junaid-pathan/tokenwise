"""A (PR A12): quality eval. Chosen gear vs Gear 5, judged by Bedrock.

For each held-out prompt:
  1. rules triage picks the gear the router would use (the "chosen" answer),
  2. generate the chosen-gear answer and a Gear 5 answer,
  3. ask the Bedrock judge whether the chosen answer is as good as Gear 5,
  4. quality match % = share of prompts judged "as good".

Run:
    python -m training.eval.quality_eval --n 100
    python -m training.eval.quality_eval --n 10   # quick smoke

Needs OLLAMA_URL (gears 1-4) and Bedrock creds (gear 5 + judge) in .env. Writes
training/eval/quality_report.json with the match % and per-gear breakdown.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from engine.agents.triage import classify
from engine.llm import generate as stub_generate
from engine.llm import ollama
from engine.llm import bedrock

load_dotenv()

_REPO = Path(__file__).resolve().parents[2]
_HELDOUT = _REPO / "training" / "data" / "heldout.jsonl"
_REPORT = _REPO / "training" / "eval" / "quality_report.json"


def _answer(gear: int, prompt: str) -> str:
    """Chosen-gear answer: Ollama for 1-4, Bedrock for 5, stub on failure."""
    try:
        if 1 <= gear <= 4:
            return ollama.generate(gear, prompt)["text"]
        return bedrock.generate(gear, prompt)["text"]
    except Exception as exc:  # keep the eval moving
        print(f"[eval] gear {gear} generate failed ({exc}); using stub")
        return stub_generate(gear, prompt)["text"]


def load_heldout(n: int) -> list[dict]:
    rows = []
    with _HELDOUT.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
            if len(rows) >= n:
                break
    return rows


def run(n: int) -> dict:
    rows = load_heldout(n)
    matches = 0
    judged = 0
    per_gear: dict[int, dict[str, int]] = {}

    for i, row in enumerate(rows, 1):
        prompt = row["prompt"]
        gear, _conf, _reason = classify(prompt)
        chosen = _answer(gear, prompt)
        gold = _answer(5, prompt)
        ok = bedrock.judge(prompt, chosen, gold)

        judged += 1
        matches += 1 if ok else 0
        g = per_gear.setdefault(gear, {"judged": 0, "matched": 0})
        g["judged"] += 1
        g["matched"] += 1 if ok else 0
        print(f"[{i}/{len(rows)}] gear {gear} -> {'match' if ok else 'MISS'}")

    pct = round(matches / judged * 100, 1) if judged else 0.0
    report = {
        "n": judged,
        "quality_match_pct": pct,
        "per_gear": {
            str(k): {
                **v,
                "pct": round(v["matched"] / v["judged"] * 100, 1) if v["judged"] else 0.0,
            }
            for k, v in sorted(per_gear.items())
        },
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=100, help="held-out prompts to judge")
    args = parser.parse_args()

    report = run(args.n)
    _REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nwrote {_REPORT.relative_to(_REPO)}")


if __name__ == "__main__":
    main()

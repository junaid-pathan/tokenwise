"""Held-out prompt loader for the crowd simulator (PR B6, owner B).

The crowd replays ONLY the 200 held-out prompts from training/data/heldout.jsonl
(written first by B3, disjoint from train.csv). Each row is
`{"prompt": str, "source": str, "gear": int}`; the sim uses the prompt text and
its character length (prompt.received carries `chars`, not text).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_HELDOUT_PATH = _REPO_ROOT / "training" / "data" / "heldout.jsonl"


@dataclass(frozen=True)
class HeldoutPrompt:
    """One held-out prompt. `gear` is the B3 label (not used for routing; the
    crowd is routed live by Aru's Triage, which only sees length)."""

    prompt: str
    source: str
    gear: int

    @property
    def chars(self) -> int:
        return len(self.prompt)


def load_heldout(path: Path = _HELDOUT_PATH) -> list[HeldoutPrompt]:
    """Load all held-out prompts. Raises if the file is missing or empty."""
    if not path.exists():
        raise FileNotFoundError(
            f"held-out prompts not found at {path}; B3 must land first"
        )
    rows: list[HeldoutPrompt] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            prompt = str(obj.get("prompt", "")).strip()
            if not prompt:
                continue
            rows.append(
                HeldoutPrompt(
                    prompt=prompt,
                    source=str(obj.get("source", "unknown")),
                    gear=int(obj.get("gear", 1)),
                )
            )
    if not rows:
        raise ValueError(f"no usable prompts in {path}")
    return rows

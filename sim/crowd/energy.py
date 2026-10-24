"""Energy estimate table for the crowd simulator (PR B6, owner B).

9 out of 10 crowd answers use an ESTIMATE of energy (energy_source "estimated").
There is no live GPU meter for the crowd path, and `est_wh_per_1k_out_tokens` in
contracts/gears.json is `null` until the Hardware gate, so until that lands we
estimate joules from a simple, honestly-documented table keyed on gear.

How the table was derived (documented, approximate — NOT measured):
  Bigger models burn more energy per answer. We scale a per-answer base roughly
  with the model's parameter count (the gears' Ollama models: 0.5B, 1B, 3B, 8B;
  gear 5 is Bedrock-only / a frontier model, so it is the largest). The numbers
  below are relative joules-per-answer for a short (~64-token) reply and are only
  meant to give the Coordinator's savings accounting a monotonic, defensible
  signal (downshifting a gear always saves energy). They are placeholders until
  the meter is wired.

If gears.json later carries a non-null `est_wh_per_1k_out_tokens`, we PREFER it:
  joules = wh_per_1k * (output_tokens / 1000) * 3600.

See sim/crowd/README.md for the table and the honesty note.
"""

from __future__ import annotations

import json
from pathlib import Path

_GEARS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "gears.json"

# Relative joules per short (~64-token) answer, by gear. Derived from model size
# (0.5B / 1B / 3B / 8B / frontier). Placeholder values, monotonic in gear.
ESTIMATE_JOULES_BY_GEAR: dict[int, float] = {
    1: 20.0,    # qwen2.5:0.5b
    2: 40.0,    # llama3.2:1b
    3: 120.0,   # llama3.2:3b
    4: 320.0,   # llama3.1:8b
    5: 900.0,   # frontier / Bedrock-only, no Ollama model
}

# Reference output length the table is calibrated for (short demo replies).
_REFERENCE_OUTPUT_TOKENS = 64


def _wh_per_1k_from_gears() -> dict[int, float]:
    """Read est_wh_per_1k_out_tokens from gears.json; {} if all null/missing."""
    out: dict[int, float] = {}
    try:
        data = json.loads(_GEARS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    for g in data.get("gears", []):
        wh = g.get("est_wh_per_1k_out_tokens")
        if wh is not None:
            try:
                out[int(g["gear"])] = float(wh)
            except (TypeError, ValueError):
                continue
    return out


def estimate_joules(gear: int, output_tokens: int = _REFERENCE_OUTPUT_TOKENS) -> float:
    """Estimate joules for one answer at `gear` producing `output_tokens` tokens.

    Prefers the gears.json per-1k-token figure once the Hardware gate fills it;
    otherwise scales the relative base table by output length vs the reference.
    """
    gear = int(gear)
    tokens = max(1, int(output_tokens))

    wh_table = _wh_per_1k_from_gears()
    if gear in wh_table:
        # Wh -> J: * 3600; per-1k-token -> per answer: * tokens/1000.
        return wh_table[gear] * (tokens / 1000.0) * 3600.0

    base = ESTIMATE_JOULES_BY_GEAR.get(gear, ESTIMATE_JOULES_BY_GEAR[3])
    # Scale linearly with output length relative to the reference reply.
    return base * (tokens / _REFERENCE_OUTPUT_TOKENS)

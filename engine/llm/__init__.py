"""JOINT interface (stub written jointly). Implementations:
  - engine/llm/ollama.py   (A: Colab tunnel, Gears 1-4)
  - engine/llm/bedrock.py  (B: Converse API, Gear 5 + labelling + judge + narrator)

Contract:
    generate(gear, prompt, max_tokens) -> {
        "text": str, "model": str, "latency_ms": int, "output_tokens": int
    }

Do not change the signature without a joint contract: PR.
"""

from __future__ import annotations

import time
from typing import Protocol, TypedDict


class GenResult(TypedDict):
    text: str
    model: str
    latency_ms: int
    output_tokens: int


class LLM(Protocol):
    def generate(self, gear: int, prompt: str, max_tokens: int = 512) -> GenResult: ...


def generate(gear: int, prompt: str, max_tokens: int = 512) -> GenResult:
    """Stub generator. Returns deterministic placeholder text so UIs and the
    answer endpoint work before ollama.py / bedrock.py land.

    Real routing (which backend serves which gear) is decided by the
    implementations, selected via .env. This stub never calls a model.
    """
    t0 = time.perf_counter()
    text = f"[stub gear {gear}] echo: {prompt[:120]}"
    latency_ms = int((time.perf_counter() - t0) * 1000)
    return GenResult(
        text=text,
        model=f"stub-gear-{gear}",
        latency_ms=latency_ms,
        output_tokens=max(1, len(text) // 4),
    )

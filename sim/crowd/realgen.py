"""Real-generation helper for the crowd simulator (PR B6, owner B).

1 in 10 crowd prompts is TRULY generated against the real backend; the other 9
use the estimate table (sim/crowd/energy.py).

For gears 1-4 we call Aru's Ollama client (engine.llm.ollama.generate) against
the Colab tunnel. The tunnel may be DOWN, so any failure (or a timeout) falls
back to the estimate and is counted as a fallback. Gear 5 has no Ollama model,
so it stays estimated.

If Aru's answer-endpoint PR (#17) ever exposes a clean in-process generate
function we could route through it; today it only registers an HTTP route, so we
call engine.llm.ollama directly behind a lazy import (so importing sim.crowd
never hard-depends on the engine LLM stack being importable at import time).

Everything here runs OFF the event loop (the caller uses asyncio.to_thread) and
reads timing itself; the caller measures energy with engine.power.energy_between
around the window when a live meter covers it.

SECURITY: never print or log OLLAMA_URL or any secret. Error messages from the
client are summarised to a short type name only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Gears that have a local Ollama model (gears.json: gear 5 is Bedrock-only).
REAL_GEARS = (1, 2, 3, 4)

# Max output tokens for a real demo generation (short replies).
REAL_MAX_TOKENS = 64

# Wall-clock budget (seconds) for one real generation before the caller gives up
# and falls back to the estimate. Kept short so a dead tunnel never stalls the
# loop for long; engine.llm.ollama has its own httpx timeout underneath this.
REAL_TIMEOUT_S = 8.0


@dataclass(frozen=True)
class RealResult:
    """Outcome of a real generation attempt."""

    ok: bool
    latency_ms: int
    output_tokens: int
    model: str
    error: Optional[str] = None  # short error class name on failure, never a URL


def _safe_error(exc: BaseException) -> str:
    """A short, secret-free description of a failure (class name only)."""
    return type(exc).__name__


def generate_real(gear: int, prompt: str, max_tokens: int = REAL_MAX_TOKENS) -> RealResult:
    """Attempt a real generation for gears 1-4. Returns RealResult.

    Runs synchronously (call via asyncio.to_thread). Any failure -> ok=False so
    the caller falls back to the estimate. Never raises for backend errors.
    """
    if gear not in REAL_GEARS:
        return RealResult(
            ok=False, latency_ms=0, output_tokens=0, model="", error="gear_not_real"
        )
    try:
        # Lazy import so sim.crowd imports cleanly even if the engine LLM stack
        # (httpx/dotenv) is unavailable in a given environment.
        from engine.llm import ollama
    except Exception as exc:  # pragma: no cover - import environment dependent
        return RealResult(
            ok=False, latency_ms=0, output_tokens=0, model="", error=_safe_error(exc)
        )

    try:
        result = ollama.generate(gear, prompt, max_tokens)
    except Exception as exc:
        # Tunnel down / timeout / model missing -> fall back, counted.
        return RealResult(
            ok=False, latency_ms=0, output_tokens=0, model="", error=_safe_error(exc)
        )

    # engine.llm.GenResult is a TypedDict (plain dict at runtime).
    return RealResult(
        ok=True,
        latency_ms=int(result.get("latency_ms", 0)),
        output_tokens=int(result.get("output_tokens", 0)),
        model=str(result.get("model", f"gear-{gear}")),
    )

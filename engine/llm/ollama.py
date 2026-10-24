"""A (PR A3): Ollama client calling the Colab tunnel URL from .env.

Implements the LLM interface from engine/llm/__init__.py for Gears 1-4.
Model names come from contracts/gears.json ("ollama_model"); requests go to
POST {OLLAMA_URL}/api/generate with stream=false.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

from engine.llm import GenResult

# The engine is started with plain `uvicorn engine.app:app`, which does not read
# .env, so load it here (real environment variables still win).
load_dotenv()

_GEARS_PATH = Path(__file__).resolve().parents[2] / "contracts" / "gears.json"

_TIMEOUT_S = 60.0
_RETRIES = 1  # one retry after the first attempt


def _ollama_url() -> str:
    url = os.environ.get("OLLAMA_URL", "").strip()
    if not url:
        raise RuntimeError(
            "OLLAMA_URL is not set. Add it to .env from the Colab host notebook."
        )
    return url.rstrip("/")


def _model_for(gear: int) -> str:
    data = json.loads(_GEARS_PATH.read_text(encoding="utf-8"))
    for g in data["gears"]:
        if int(g["gear"]) == gear:
            model = g.get("ollama_model")
            if not model:
                raise ValueError(f"gear {gear} has no ollama_model (Bedrock-only)")
            return model
    raise ValueError(f"unknown gear {gear}")


def generate(gear: int, prompt: str, max_tokens: int = 512) -> GenResult:
    """Generate text for Gears 1-4 via the Colab Ollama tunnel.

    Returns {text, model, latency_ms, output_tokens}.
    """
    model = _model_for(gear)
    url = _ollama_url() + "/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }

    t0 = time.perf_counter()
    last_exc: Exception | None = None
    for attempt in range(_RETRIES + 1):
        try:
            resp = httpx.post(url, json=payload, timeout=_TIMEOUT_S)
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            if attempt < _RETRIES:
                continue
            raise RuntimeError(
                f"ollama generate failed for gear {gear} after {_RETRIES + 1} attempts: {exc}"
            ) from last_exc
    latency_ms = int((time.perf_counter() - t0) * 1000)

    text = data.get("response", "")
    output_tokens = int(data.get("eval_count") or max(1, len(text) // 4))
    return GenResult(
        text=text,
        model=model,
        latency_ms=latency_ms,
        output_tokens=output_tokens,
    )

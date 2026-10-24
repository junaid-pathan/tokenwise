"""B (PR B2): Bedrock client using the Converse API.

Serves Gear 5, plus labelling, the quality judge, and the Narrator.
Falls back to A's Colab models (gears 1-4) or the shared stub (gear 5)
when Bedrock is unavailable, so callers never crash.

Model IDs are read from contracts/gears.json at call time (field
``bedrock_model``). Set ``GEARS_JSON_PATH`` to point at an alternate
gears.json (used for testing before the contract PR merges).
"""

from __future__ import annotations

import json
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from engine.llm import GenResult, generate as _stub_generate

# Load credentials (AWS_BEARER_TOKEN_BEDROCK, AWS_REGION) from .env if present.
# Never print or log any value from here.
load_dotenv()

# A Sonnet-class model for the quality judge. Resolved from gears.json gear 5
# (which is Sonnet) so we track the verified contract ID.
_JUDGE_GEAR = 5


def _gears_path() -> Path:
    """Locate contracts/gears.json, honouring the GEARS_JSON_PATH override."""
    override = os.environ.get("GEARS_JSON_PATH")
    if override:
        return Path(override)
    # engine/llm/bedrock.py -> repo root is two parents up from engine/.
    repo_root = Path(__file__).resolve().parents[2]
    return repo_root / "contracts" / "gears.json"


def _load_gears() -> dict:
    """Read and parse gears.json from the resolved path.

    Read at call time (no module-level cache keyed on nothing) so the override
    and any contract update are picked up without a restart. We memoise per
    resolved path+mtime to avoid re-reading on every single call.
    """
    path = _gears_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    return _load_gears_cached(str(path), mtime)


@lru_cache(maxsize=8)
def _load_gears_cached(path_str: str, _mtime: float) -> dict:
    with open(path_str, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _region(gears: Optional[dict] = None) -> str:
    """Region: gears.json 'bedrock_region' if present, else AWS_REGION, else us-east-2."""
    if gears is None:
        try:
            gears = _load_gears()
        except Exception:
            gears = {}
    region = gears.get("bedrock_region") if gears else None
    return region or os.environ.get("AWS_REGION") or "us-east-2"


def _model_for_gear(gear: int) -> str:
    gears = _load_gears()
    for entry in gears.get("gears", []):
        if entry.get("gear") == gear:
            model = entry.get("bedrock_model")
            if not model:
                raise ValueError(f"gear {gear} has no bedrock_model in gears.json")
            return model
    raise ValueError(f"gear {gear} not found in gears.json")


@lru_cache(maxsize=4)
def _client(region: str):
    """Create (and cache) a bedrock-runtime client for a region.

    Credentials are picked up by boto3 from the environment, including the
    Bedrock API key in AWS_BEARER_TOKEN_BEDROCK (requires boto3 >= 1.39).
    """
    import boto3  # imported lazily so import of this module never needs boto3

    return boto3.client("bedrock-runtime", region_name=region)


def _converse_raw(
    model_id: str,
    prompt: str,
    system: Optional[str],
    max_tokens: int,
    temperature: float,
    region: str,
) -> GenResult:
    """Single Bedrock Converse call. Raises on any Bedrock/boto3 error."""
    client = _client(region)

    kwargs = {
        "modelId": model_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": temperature,
        },
    }
    if system:
        kwargs["system"] = [{"text": system}]

    t0 = time.perf_counter()
    resp = client.converse(**kwargs)
    latency_ms = int((time.perf_counter() - t0) * 1000)

    parts = resp.get("output", {}).get("message", {}).get("content", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    output_tokens = int(resp.get("usage", {}).get("outputTokens", 0))

    return GenResult(
        text=text,
        model=model_id,
        latency_ms=latency_ms,
        output_tokens=output_tokens,
    )


def converse(
    model_id: str,
    prompt: str,
    system: Optional[str] = None,
    max_tokens: int = 512,
    temperature: float = 0,
) -> GenResult:
    """Generic Converse helper for the Narrator and labelling.

    Calls Bedrock directly with an explicit model id. On failure, falls back
    to the shared stub so callers never crash. The fallback is logged.
    """
    try:
        return _converse_raw(
            model_id, prompt, system, max_tokens, temperature, _region()
        )
    except Exception as exc:  # noqa: BLE001 - any Bedrock/boto3 failure
        print(f"[bedrock] converse({model_id}) failed, using stub fallback: {exc}")
        return _stub_generate(_JUDGE_GEAR, prompt, max_tokens)


def generate(gear: int, prompt: str, max_tokens: int = 512) -> GenResult:
    """Generate text for a gear via Bedrock Converse.

    On any Bedrock failure (no credentials, AccessDenied, throttling, timeout,
    network), fall back to ollama.generate for gears 1-4 and to the shared stub
    for gear 5, so callers never crash.
    """
    try:
        model_id = _model_for_gear(gear)
        return _converse_raw(model_id, prompt, None, max_tokens, 0, _region())
    except Exception as exc:  # noqa: BLE001 - any failure path
        print(f"[bedrock] generate(gear={gear}) failed, falling back: {exc}")
        if gear <= 4:
            # Defer the ollama import so a broken ollama module can't break
            # the whole bedrock module at import time.
            from engine.llm import ollama

            return ollama.generate(gear, prompt, max_tokens)
        return _stub_generate(gear, prompt, max_tokens)


def judge(question: str, answer_a: str, answer_b: str) -> bool:
    """Quality judge: ask a Sonnet-class model whether answer A is as good as B.

    Returns True when the model replies YES. On any failure the judge is
    lenient (returns True) so the pipeline keeps moving.
    """
    try:
        model_id = _model_for_gear(_JUDGE_GEAR)
    except Exception as exc:  # noqa: BLE001
        print(f"[bedrock] judge: could not resolve model, defaulting True: {exc}")
        return True

    prompt = (
        "Is answer A as good as answer B for this question? "
        "Reply only YES or NO.\n\n"
        f"Question: {question}\n\n"
        f"Answer A: {answer_a}\n\n"
        f"Answer B: {answer_b}"
    )
    try:
        result = _converse_raw(model_id, prompt, None, 8, 0, _region())
    except Exception as exc:  # noqa: BLE001
        print(f"[bedrock] judge failed, defaulting True: {exc}")
        return True

    return result["text"].strip().upper().startswith("YES")

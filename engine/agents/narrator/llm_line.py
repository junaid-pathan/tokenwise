"""Optional LLM phrasing for Narrator lines, via engine.llm.bedrock.converse.

Policy:
  * Controlled by env NARRATOR_USE_LLM: "0" disables; otherwise on when AWS
    credentials appear to exist (so tests and offline runs stay deterministic).
  * Capped at NARRATOR_MAX_LLM_CALLS per process (default 60).
  * The blocking boto3 Converse call runs off the event loop via
    asyncio.to_thread with a ~3 s timeout.
  * The model id is read from contracts/gears.json (gear-1 or gear-2
    bedrock_model) via engine.llm.bedrock — never hard-coded here.
  * The LLM only rephrases facts we already have; it is given the exact numbers
    and told to use ONLY those. Its output is re-checked with the same guard by
    the caller, so ANY failure (exception, timeout, no creds, too long, bad
    number, empty) falls back to the template line.

Users never see the words "model" or "tokens": those appear only in the system
prompt we send, never in published lines.
"""

from __future__ import annotations

import asyncio
import os
from typing import Optional

LLM_TIMEOUT_S = 3.0
DEFAULT_MAX_LLM_CALLS = 60

# Which gear's bedrock_model to use for phrasing (fast + cheap).
_PHRASE_GEAR = 1

_SYSTEM = (
    "You rewrite grid-and-energy facts as ONE short sentence of plain English, "
    "at most 18 words. Use ONLY the numbers given, exactly as written. Do not "
    "add, drop, or change any number. Do not invent facts. Reply with the "
    "sentence only, no preamble."
)


class LlmBudget:
    """Per-process cap on real Bedrock calls."""

    def __init__(self, max_calls: Optional[int] = None) -> None:
        if max_calls is None:
            max_calls = int(os.environ.get("NARRATOR_MAX_LLM_CALLS", DEFAULT_MAX_LLM_CALLS))
        self.max_calls = max_calls
        self.used = 0

    def available(self) -> bool:
        return self.used < self.max_calls

    def spend(self) -> None:
        self.used += 1


def llm_enabled() -> bool:
    """On unless NARRATOR_USE_LLM=0, and only when credentials seem present."""
    flag = os.environ.get("NARRATOR_USE_LLM")
    if flag == "0":
        return False
    if flag == "1":
        return True
    # Default: on only if some AWS credential is configured.
    return bool(
        os.environ.get("AWS_BEARER_TOKEN_BEDROCK")
        or os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_PROFILE")
    )


def _model_id() -> str:
    """Resolve the gear-1 (fast) bedrock_model from gears.json via bedrock."""
    from engine.llm import bedrock

    return bedrock._model_for_gear(_PHRASE_GEAR)


def _build_prompt(template_line: str, numbers: list[float]) -> str:
    nums = ", ".join(
        (str(int(n)) if float(n).is_integer() else str(n)) for n in numbers
    )
    allowed = f"Allowed numbers: {nums}." if nums else "Use no numbers."
    return (
        "Rephrase this status line in at most 18 words, plain English, "
        "keeping the meaning:\n"
        f"'{template_line}'\n"
        f"{allowed}"
    )


async def phrase_line(
    template_line: str,
    numbers: list[float],
    *,
    converse=None,
    model_id: Optional[str] = None,
) -> Optional[str]:
    """Ask the LLM to rephrase. Returns the text, or None on ANY failure.

    `converse` and `model_id` are injectable so tests can pass a fake without
    touching Bedrock. The caller MUST still run the guard on the result.
    """
    if converse is None:
        from engine.llm import bedrock

        converse = bedrock.converse
    if model_id is None:
        try:
            model_id = _model_id()
        except Exception:
            return None

    prompt = _build_prompt(template_line, numbers)

    def _call() -> str:
        result = converse(
            model_id,
            prompt,
            system=_SYSTEM,
            max_tokens=60,
            temperature=0,
        )
        # GenResult is a TypedDict (a dict) with a "text" field.
        return (result.get("text") or "").strip()

    try:
        text = await asyncio.wait_for(asyncio.to_thread(_call), timeout=LLM_TIMEOUT_S)
    except Exception:
        return None

    if not text:
        return None
    return text

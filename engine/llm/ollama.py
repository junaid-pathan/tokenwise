"""A (PR A3): Ollama client calling the Colab tunnel URL from .env.

Implements the LLM interface from engine/llm/__init__.py for Gears 1-4.
Stub for now; fills in during A3.
"""

from __future__ import annotations

import os

from engine.llm import GenResult, generate as _stub_generate

OLLAMA_URL = os.environ.get("OLLAMA_URL", "")


def generate(gear: int, prompt: str, max_tokens: int = 512) -> GenResult:
    # TODO(A3): POST to {OLLAMA_URL}/api/generate with the gear's ollama_model
    # from contracts/gears.json. Fall back to the stub until wired.
    return _stub_generate(gear, prompt, max_tokens)

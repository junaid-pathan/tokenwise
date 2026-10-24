"""B (PR B2): Bedrock client using the Converse API.

Serves Gear 5, plus labelling, the quality judge, and the Narrator.
Falls back to A's Colab models when Bedrock is unavailable.
Stub for now; fills in during B2.
"""

from __future__ import annotations

import os

from engine.llm import GenResult, generate as _stub_generate

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def generate(gear: int, prompt: str, max_tokens: int = 512) -> GenResult:
    # TODO(B2): boto3 bedrock-runtime client.converse(...) with the gear's
    # bedrock_model from contracts/gears.json. Fall back to the stub for now.
    return _stub_generate(gear, prompt, max_tokens)


def judge(question: str, answer_a: str, answer_b: str) -> bool:
    """TODO(B2/quality): ask Sonnet 'Is answer A as good as B?' -> bool."""
    return True

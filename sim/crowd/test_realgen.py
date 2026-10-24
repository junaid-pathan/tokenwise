"""Unit tests: the 1-in-10 real-generation helper (PR B6).

These never hit the network: they monkeypatch engine.llm.ollama.generate, or
rely on gear 5 being Bedrock-only (so realgen short-circuits before any import).
"""

from __future__ import annotations

from sim.crowd import realgen


def test_gear_5_is_not_a_real_gear():
    """Gear 5 has no Ollama model, so it must stay estimated (never attempted)."""
    assert 5 not in realgen.REAL_GEARS
    result = realgen.generate_real(5, "hard proof about primes")
    assert result.ok is False
    assert result.error == "gear_not_real"


def test_timeout_is_short_and_positive():
    """A short wall-clock budget so a dead tunnel never stalls the loop."""
    assert 0 < realgen.REAL_TIMEOUT_S <= 15.0


def test_generate_real_ok_maps_genresult(monkeypatch):
    import engine.llm.ollama as ollama

    def fake_generate(gear, prompt, max_tokens):
        return {"text": "hi", "model": "qwen2.5:0.5b", "latency_ms": 42, "output_tokens": 7}

    monkeypatch.setattr(ollama, "generate", fake_generate)
    result = realgen.generate_real(1, "2+2?")
    assert result.ok is True
    assert result.latency_ms == 42
    assert result.output_tokens == 7
    assert result.model == "qwen2.5:0.5b"


def test_generate_real_failure_is_safe(monkeypatch):
    """A backend error returns ok=False and a secret-free class name, never raises."""
    import engine.llm.ollama as ollama

    def boom(gear, prompt, max_tokens):
        raise RuntimeError("ollama generate failed: http://secret-tunnel/api")

    monkeypatch.setattr(ollama, "generate", boom)
    result = realgen.generate_real(2, "summarize this")
    assert result.ok is False
    assert result.error == "RuntimeError"  # class name only, no URL leaked
    assert "http" not in (result.error or "")

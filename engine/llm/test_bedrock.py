"""Tests for engine.llm.bedrock.

The fallback paths are tested with a mocked failing Bedrock client so no
network or AWS credentials are needed. A separate opt-in test exercises a
real Converse call when BEDROCK_LIVE=1 is set.
"""

from __future__ import annotations

import json
import os

import pytest

from engine.llm import bedrock


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def gears_file(tmp_path, monkeypatch):
    """Write a minimal gears.json and point GEARS_JSON_PATH at it."""
    data = {
        "bedrock_region": "us-east-2",
        "gears": [
            {"gear": 1, "bedrock_model": "model-g1"},
            {"gear": 2, "bedrock_model": "model-g2"},
            {"gear": 3, "bedrock_model": "model-g3"},
            {"gear": 4, "bedrock_model": "model-g4"},
            {"gear": 5, "bedrock_model": "model-g5"},
        ],
    }
    path = tmp_path / "gears.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("GEARS_JSON_PATH", str(path))
    # Drop any memoised gears read from a previous test/path.
    bedrock._load_gears_cached.cache_clear()
    bedrock._client.cache_clear()
    return path


def _force_bedrock_failure(monkeypatch):
    """Make every Bedrock Converse call raise, with no network."""
    def boom(*_args, **_kwargs):
        raise RuntimeError("simulated bedrock failure (no credentials)")

    monkeypatch.setattr(bedrock, "_converse_raw", boom)


# ---------------------------------------------------------------------------
# gears.json reading
# ---------------------------------------------------------------------------

def test_model_for_gear_reads_override(gears_file):
    assert bedrock._model_for_gear(1) == "model-g1"
    assert bedrock._model_for_gear(5) == "model-g5"


def test_region_prefers_gears_json(gears_file):
    assert bedrock._region() == "us-east-2"


def test_region_env_fallback(tmp_path, monkeypatch):
    data = {"gears": [{"gear": 5, "bedrock_model": "m5"}]}
    path = tmp_path / "gears.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("GEARS_JSON_PATH", str(path))
    monkeypatch.setenv("AWS_REGION", "eu-west-1")
    bedrock._load_gears_cached.cache_clear()
    assert bedrock._region() == "eu-west-1"


def test_region_default_us_east_2(tmp_path, monkeypatch):
    data = {"gears": [{"gear": 5, "bedrock_model": "m5"}]}
    path = tmp_path / "gears.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("GEARS_JSON_PATH", str(path))
    monkeypatch.delenv("AWS_REGION", raising=False)
    bedrock._load_gears_cached.cache_clear()
    assert bedrock._region() == "us-east-2"


def test_unknown_gear_raises(gears_file):
    with pytest.raises(ValueError):
        bedrock._model_for_gear(9)


# ---------------------------------------------------------------------------
# Fallback paths (mocked failing client, no network)
# ---------------------------------------------------------------------------

def test_generate_gears_1_to_4_fall_back_to_ollama(gears_file, monkeypatch):
    _force_bedrock_failure(monkeypatch)
    sentinel = bedrock.GenResult(
        text="ollama-answer", model="ollama-x", latency_ms=1, output_tokens=2
    )
    import engine.llm.ollama as ollama
    monkeypatch.setattr(ollama, "generate", lambda g, p, m=512: sentinel)

    for gear in (1, 2, 3, 4):
        result = bedrock.generate(gear, "hello", 20)
        assert result == sentinel


def test_generate_gear_5_falls_back_to_stub(gears_file, monkeypatch):
    _force_bedrock_failure(monkeypatch)
    result = bedrock.generate(5, "hello", 20)
    # The shared stub echoes the prompt and tags the model with the gear.
    assert "hello" in result["text"]
    assert result["model"] == "stub-gear-5"
    assert result["output_tokens"] >= 1


def test_generate_result_shape(gears_file, monkeypatch):
    _force_bedrock_failure(monkeypatch)
    result = bedrock.generate(5, "hello", 20)
    assert set(result.keys()) == {"text", "model", "latency_ms", "output_tokens"}
    assert isinstance(result["text"], str)
    assert isinstance(result["model"], str)
    assert isinstance(result["latency_ms"], int)
    assert isinstance(result["output_tokens"], int)


def test_converse_falls_back_to_stub(gears_file, monkeypatch):
    _force_bedrock_failure(monkeypatch)
    result = bedrock.converse("some-model", "say hi", max_tokens=20)
    assert isinstance(result["text"], str)
    assert set(result.keys()) == {"text", "model", "latency_ms", "output_tokens"}


def test_judge_defaults_true_on_failure(gears_file, monkeypatch):
    _force_bedrock_failure(monkeypatch)
    assert bedrock.judge("q", "a", "b") is True


def test_judge_parses_yes(gears_file, monkeypatch):
    def fake(model_id, prompt, system, max_tokens, temperature, region):
        return bedrock.GenResult(
            text="YES", model=model_id, latency_ms=1, output_tokens=1
        )
    monkeypatch.setattr(bedrock, "_converse_raw", fake)
    assert bedrock.judge("q", "a", "b") is True


def test_judge_parses_no(gears_file, monkeypatch):
    def fake(model_id, prompt, system, max_tokens, temperature, region):
        return bedrock.GenResult(
            text="NO", model=model_id, latency_ms=1, output_tokens=1
        )
    monkeypatch.setattr(bedrock, "_converse_raw", fake)
    assert bedrock.judge("q", "a", "b") is False


def test_no_secret_in_fallback_logs(gears_file, monkeypatch, capsys):
    """Fallback logging must not leak any bearer token value."""
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "SECRET-TOKEN-VALUE-123")
    _force_bedrock_failure(monkeypatch)
    bedrock.generate(5, "hello", 20)
    out = capsys.readouterr()
    assert "SECRET-TOKEN-VALUE-123" not in out.out
    assert "SECRET-TOKEN-VALUE-123" not in out.err


# ---------------------------------------------------------------------------
# Optional live test (opt-in; real Bedrock call)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    os.environ.get("BEDROCK_LIVE") != "1",
    reason="set BEDROCK_LIVE=1 to run a real Bedrock Converse call",
)
def test_live_generate_gear_5_returns_text():
    result = bedrock.generate(5, "Reply with the single word: ok", 20)
    assert isinstance(result["text"], str)
    assert result["text"]

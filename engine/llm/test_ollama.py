"""Tests for the Ollama client (A3). No network: httpx.post is mocked."""

from __future__ import annotations

import httpx
import pytest

from engine.llm import ollama


class FakeResp:
    def __init__(self, payload=None, status=200):
        self._payload, self.status_code = payload or {}, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "boom", request=httpx.Request("POST", "http://x"), response=httpx.Response(self.status_code)
            )

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _url(monkeypatch):
    monkeypatch.setenv("OLLAMA_URL", "http://example.invalid/")


def test_success_shape_and_model_from_gears_json(monkeypatch):
    seen = {}

    def fake_post(url, json, timeout):
        seen.update(url=url, json=json)
        return FakeResp({"response": "ok", "eval_count": 3})

    monkeypatch.setattr(ollama.httpx, "post", fake_post)
    r = ollama.generate(1, "hi", 20)
    assert r["text"] == "ok" and r["output_tokens"] == 3
    assert r["model"] == "qwen2.5:0.5b"
    assert seen["url"] == "http://example.invalid/api/generate"  # trailing slash stripped
    assert seen["json"]["options"]["num_predict"] == 20 and seen["json"]["stream"] is False


def test_one_retry_then_success(monkeypatch):
    calls = {"n": 0}

    def flaky(url, json, timeout):
        calls["n"] += 1
        return FakeResp(status=530) if calls["n"] == 1 else FakeResp({"response": "ok"})

    monkeypatch.setattr(ollama.httpx, "post", flaky)
    assert ollama.generate(2, "hi")["text"] == "ok" and calls["n"] == 2


def test_fails_after_retry_with_clear_error(monkeypatch):
    monkeypatch.setattr(ollama.httpx, "post", lambda *a, **k: FakeResp(status=530))
    with pytest.raises(RuntimeError, match="after 2 attempts"):
        ollama.generate(1, "hi")


def test_gear5_is_bedrock_only_and_missing_url_is_explicit(monkeypatch):
    with pytest.raises(ValueError, match="no ollama_model"):
        ollama.generate(5, "hi")
    monkeypatch.setenv("OLLAMA_URL", "")
    with pytest.raises(RuntimeError, match="OLLAMA_URL is not set"):
        ollama.generate(1, "hi")

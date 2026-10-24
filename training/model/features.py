"""A (PR A4-full): feature extraction for the gear classifier.

Features per prompt:
  * all-MiniLM-L6-v2 sentence embedding (384 dims)
  * hand features: char length, word count, digit ratio, has-math-symbol,
    has-code-marker, question-mark count (all scaled into a small vector)

Kept in one place so train.py and the runtime classifier build features identically.
"""

from __future__ import annotations

import re

import numpy as np

_EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
_MATH_RE = re.compile(r"[0-9]|[-+*/=%^]|\b(sum|percent|solve|integral|derivative)\b", re.I)
_CODE_RE = re.compile(r"```|def |class |function |import |#include|=>|\bregex\b|\bSQL\b", re.I)

_model = None


def _embedder():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(_EMBED_MODEL_NAME)
    return _model


def hand_features(prompt: str) -> list[float]:
    text = prompt or ""
    n = len(text)
    words = text.split()
    digits = sum(c.isdigit() for c in text)
    return [
        min(n, 2000) / 2000.0,                 # scaled char length
        min(len(words), 400) / 400.0,          # scaled word count
        (digits / n) if n else 0.0,            # digit ratio
        1.0 if _MATH_RE.search(text) else 0.0, # math signal
        1.0 if _CODE_RE.search(text) else 0.0, # code signal
        min(text.count("?"), 5) / 5.0,         # question density
    ]


def embed(prompts: list[str]) -> np.ndarray:
    vecs = _embedder().encode(prompts, batch_size=64, show_progress_bar=False,
                              normalize_embeddings=True)
    return np.asarray(vecs, dtype=np.float32)


def featurize(prompts: list[str]) -> np.ndarray:
    """Concatenate embeddings + hand features into one matrix."""
    emb = embed(prompts)
    hand = np.asarray([hand_features(p) for p in prompts], dtype=np.float32)
    return np.hstack([emb, hand])

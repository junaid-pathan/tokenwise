"""A (PR A4-full): runtime gear classifier.

Loads gear_clf.joblib (MiniLM + hand features -> logistic regression) and predicts
a gear with a confidence. If the model file or its deps are missing, falls back to
the A1 rules triage so the engine never breaks.

    from training.model.classifier import predict
    gear, confidence, source = predict("write a haiku about the grid")
    # source is "model" or "rules"
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

_MODEL_PATH = Path(__file__).resolve().parent / "gear_clf.joblib"

# Rules confidence at or above this comes from a keyword hit, not a length default.
_RULES_TRUST = 0.8
# Easy-gear rules (1-2) only override on short prompts: the arithmetic rule also
# fires on long word problems. Hard-gear rules (3-5) override at any length.
_RULES_MAX_WORDS = 10
_HARD_GEAR = 3

_clf = None
_loaded = False


def _load():
    global _clf, _loaded
    if _loaded:
        return _clf
    _loaded = True
    try:
        import joblib

        if _MODEL_PATH.exists():
            _clf = joblib.load(_MODEL_PATH)
    except Exception as exc:  # deps or file problem -> rules fallback
        print(f"[classifier] model unavailable ({exc}); using rules")
        _clf = None
    return _clf


def predict(prompt: str) -> tuple[int, float, str]:
    """Return (gear 1-5, confidence 0-1, source 'model'|'rules')."""
    clf = _load()
    if clf is not None:
        try:
            from training.model.features import featurize

            X = featurize([prompt or ""])
            proba = clf.predict_proba(X)[0]
            gear = int(clf.classes_[proba.argmax()])
            conf = float(proba.max())
            # The model underrates hard prompts (debug, implement, prove, design)
            # and misses arithmetic. Where the rules have a keyword hit, they win:
            # hard-gear hits at any length, easy-gear hits on short prompts only.
            # With no keyword hit the model decides (e.g. code, emails).
            from engine.agents.triage import classify

            r_gear, r_conf, _reason = classify(prompt or "")
            if r_conf >= _RULES_TRUST:
                short = len((prompt or "").split()) <= _RULES_MAX_WORDS
                if r_gear >= _HARD_GEAR or (short and r_conf > conf):
                    return r_gear, r_conf, "rules"
            return gear, conf, "model"
        except Exception as exc:
            print(f"[classifier] predict failed ({exc}); using rules")

    # fallback: A1 rules triage
    from engine.agents.triage import classify

    gear, conf, _reason = classify(prompt)
    return gear, conf, "rules"

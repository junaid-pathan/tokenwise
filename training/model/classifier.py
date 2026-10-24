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
            return gear, float(proba.max()), "model"
        except Exception as exc:
            print(f"[classifier] predict failed ({exc}); using rules")

    # fallback: A1 rules triage
    from engine.agents.triage import classify

    gear, conf, _reason = classify(prompt)
    return gear, conf, "rules"

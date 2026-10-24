"""A (PR A4-full): train the gear classifier.

MiniLM embeddings + hand features -> multinomial logistic regression, evaluated
with 5-fold CV reporting exact and within-one-gear accuracy. Saves gear_clf.joblib.

Run:
    python -m training.model.train
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold

from training.model.features import featurize

_REPO = Path(__file__).resolve().parents[2]
_TRAIN_CSV = _REPO / "training" / "data" / "train.csv"
_MODEL_OUT = _REPO / "training" / "model" / "gear_clf.joblib"
_REPORT = _REPO / "training" / "model" / "train_report.json"


def _within_one(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred) <= 1))


def main() -> None:
    df = pd.read_csv(_TRAIN_CSV)
    df = df.dropna(subset=["prompt", "gear"])
    prompts = df["prompt"].astype(str).tolist()
    y = df["gear"].astype(int).to_numpy()
    print(f"training rows: {len(prompts)}  gear dist: "
          f"{ {int(g): int((y == g).sum()) for g in sorted(set(y))} }")

    print("featurizing (embeddings + hand features)...")
    X = featurize(prompts)

    # 5-fold CV for honest accuracy estimates.
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    exact, within1 = [], []
    for k, (tr, te) in enumerate(skf.split(X, y), 1):
        clf = LogisticRegression(max_iter=1000, C=4.0, class_weight="balanced")
        clf.fit(X[tr], y[tr])
        pred = clf.predict(X[te])
        e = float(np.mean(pred == y[te]))
        w = _within_one(y[te], pred)
        exact.append(e)
        within1.append(w)
        print(f"  fold {k}: exact={e:.3f}  within-1={w:.3f}")

    report = {
        "n": len(prompts),
        "exact_acc": round(float(np.mean(exact)), 4),
        "within_one_acc": round(float(np.mean(within1)), 4),
        "target_within_one": 0.85,
        "passes_target": bool(np.mean(within1) >= 0.85),
    }
    print(f"\nCV exact={report['exact_acc']}  within-1={report['within_one_acc']}  "
          f"(target >= 0.85 within-1: {'PASS' if report['passes_target'] else 'FAIL'})")

    # fit final model on all data and save
    final = LogisticRegression(max_iter=1000, C=4.0, class_weight="balanced")
    final.fit(X, y)
    joblib.dump(final, _MODEL_OUT)
    _REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"saved {_MODEL_OUT.relative_to(_REPO)} and {_REPORT.name}")


if __name__ == "__main__":
    main()

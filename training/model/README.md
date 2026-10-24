# training/model/ — owner A (Aru), PR A4

Classifier: `all-MiniLM-L6-v2` embeddings + length/digit/code features ->
multinomial logistic regression, 5-fold CV. Save with joblib as `gear_clf.joblib`.
Target: within-one-gear accuracy >= 85% on B's labels. Falls back to A1 rules if missing.

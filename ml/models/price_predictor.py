"""Offline training script — train & evaluate the RandomForest price predictor.

Usage:
    python ml/models/price_predictor.py --symbol RELIANCE.NS --period 2y

Saves model to ml/models/saved/<symbol>.joblib for inspection.
The backend trains on-the-fly; this script is for research only.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import StratifiedKFold, cross_val_score

from ml.features.feature_engineering import load_symbol

FEATURES = [
    "rsi", "macd", "macd_hist", "sma20_ratio", "sma50_ratio",
    "bb_position", "atr_pct", "vol_ratio", "ret_1d", "ret_5d",
    "ret_20d", "high_low_ratio", "price_vs_52w_high", "obv_trend",
]


def train(symbol: str, period: str = "2y") -> RandomForestClassifier:
    df = load_symbol(symbol, period).dropna(subset=FEATURES + ["target"])
    X = df[FEATURES].values
    y = df["target"].values

    model = RandomForestClassifier(n_estimators=200, max_depth=8, random_state=42, n_jobs=-1)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")
    print(f"CV accuracy: {scores.mean():.3f} ± {scores.std():.3f}")

    model.fit(X, y)
    print("\nFeature importances:")
    for feat, imp in sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1]):
        print(f"  {feat:<25} {imp:.4f}")

    y_pred = model.predict(X)
    print("\nIn-sample report:")
    print(classification_report(y, y_pred, target_names=["DOWN", "UP"]))

    return model


def save(model: RandomForestClassifier, symbol: str) -> Path:
    save_dir = Path(__file__).parent / "saved"
    save_dir.mkdir(exist_ok=True)
    path = save_dir / f"{symbol.replace('.', '_')}.joblib"
    joblib.dump(model, path)
    print(f"Saved to {path}")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="RELIANCE.NS")
    parser.add_argument("--period", default="2y")
    args = parser.parse_args()

    m = train(args.symbol, args.period)
    save(m, args.symbol)

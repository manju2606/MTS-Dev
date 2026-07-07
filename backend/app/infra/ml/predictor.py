"""ML price direction predictor — RandomForest on 14 technical features.

Trains on ~1 year of daily data from yfinance on each call (stateless — no model file).
Predicts next-day direction: UP (1) or DOWN (0).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from functools import partial

import numpy as np
import pandas as pd

_MODEL_CACHE: dict[str, tuple[MLPrediction, float]] = {}
_CACHE_TTL = 3_600  # 1 hour — retrain at most once per hour per symbol


@dataclass
class MLPrediction:
    symbol: str
    prediction: str  # UP | DOWN
    probability: float  # 0.0–1.0 (confidence for predicted class)
    feature_importances: dict[str, float]
    training_samples: int
    accuracy_cv: float  # cross-val accuracy estimate


_FEATURES = [
    "rsi",
    "macd",
    "macd_hist",
    "sma20_ratio",
    "sma50_ratio",
    "bb_position",
    "atr_pct",
    "vol_ratio",
    "ret_1d",
    "ret_5d",
    "ret_20d",
    "high_low_ratio",
    "price_vs_52w_high",
    "obv_trend",
]


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    c = df["Close"]
    v = df["Volume"]

    # RSI
    df["rsi"] = _compute_rsi(c)

    # MACD
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    df["macd"] = macd
    df["macd_hist"] = macd - signal

    # SMA ratios
    sma20 = c.rolling(20).mean()
    sma50 = c.rolling(50).mean()
    df["sma20_ratio"] = c / sma20 - 1
    df["sma50_ratio"] = c / sma50 - 1

    # Bollinger Band position
    std20 = c.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    df["bb_position"] = (c - bb_lower) / (bb_upper - bb_lower + 1e-9)

    # ATR %
    tr = pd.concat(
        [
            df["High"] - df["Low"],
            (df["High"] - df["Close"].shift()).abs(),
            (df["Low"] - df["Close"].shift()).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(14).mean()
    df["atr_pct"] = atr / c

    # Volume ratio
    df["vol_ratio"] = v / v.rolling(20).mean()

    # Returns
    df["ret_1d"] = c.pct_change(1)
    df["ret_5d"] = c.pct_change(5)
    df["ret_20d"] = c.pct_change(20)

    # High-low ratio
    df["high_low_ratio"] = df["High"] / df["Low"] - 1

    # Price vs 52-week high
    high_52w = c.rolling(252).max()
    df["price_vs_52w_high"] = c / high_52w - 1

    # OBV trend (slope over 20 days)
    obv = (v * (c.diff().apply(np.sign))).cumsum()
    df["obv_trend"] = obv.diff(20) / (obv.rolling(20).std() + 1e-9)

    return df


def _train_and_predict_sync(symbol: str) -> MLPrediction:
    import yfinance as yf
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import cross_val_score

    ticker = yf.Ticker(symbol)
    df = ticker.history(period="2y")
    if df.empty or len(df) < 100:
        raise ValueError(f"Insufficient data for {symbol}")

    df = df.copy()
    df = _build_features(df)

    # Label: next-day return > 0
    df["target"] = (df["Close"].shift(-1) > df["Close"]).astype(int)

    df = df.dropna(subset=_FEATURES + ["target"])
    if len(df) < 60:
        raise ValueError(f"Not enough clean rows for {symbol} after feature computation")

    X = df[_FEATURES].values
    y = df["target"].values

    # Train on all but last row; predict last row
    X_train, X_pred = X[:-1], X[-1:]
    y_train = y[:-1]

    model = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)

    cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring="accuracy")
    proba = model.predict_proba(X_pred)[0]
    predicted_class = int(model.predict(X_pred)[0])

    vals = [round(float(v), 4) for v in model.feature_importances_]
    importances = dict(zip(_FEATURES, vals, strict=True))
    top_features = dict(sorted(importances.items(), key=lambda x: -x[1])[:6])

    return MLPrediction(
        symbol=symbol,
        prediction="UP" if predicted_class == 1 else "DOWN",
        probability=round(float(proba[predicted_class]), 3),
        feature_importances=top_features,
        training_samples=len(X_train),
        accuracy_cv=round(float(cv_scores.mean()), 3),
    )


async def predict(symbol: str) -> MLPrediction:
    cached = _MODEL_CACHE.get(symbol)
    if cached and (time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, partial(_train_and_predict_sync, symbol))
    _MODEL_CACHE[symbol] = (result, time.time())
    return result


def invalidate_cache(symbol: str | None = None) -> None:
    if symbol:
        _MODEL_CACHE.pop(symbol, None)
    else:
        _MODEL_CACHE.clear()

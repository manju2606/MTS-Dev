"""Standalone feature engineering pipeline for research/notebooks.

Mirrors the logic in backend/app/infra/ml/predictor.py.
Use this in Jupyter notebooks or offline training runs.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c, v = df["Close"], df["Volume"]

    df["rsi"] = compute_rsi(c)

    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    df["macd"] = macd
    df["macd_hist"] = macd - macd.ewm(span=9, adjust=False).mean()

    sma20 = c.rolling(20).mean()
    sma50 = c.rolling(50).mean()
    df["sma20_ratio"] = c / sma20 - 1
    df["sma50_ratio"] = c / sma50 - 1

    std20 = c.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    df["bb_position"] = (c - bb_lower) / (bb_upper - bb_lower + 1e-9)

    tr = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - c.shift()).abs(),
        (df["Low"] - c.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr_pct"] = tr.rolling(14).mean() / c

    df["vol_ratio"] = v / v.rolling(20).mean()
    df["ret_1d"] = c.pct_change(1)
    df["ret_5d"] = c.pct_change(5)
    df["ret_20d"] = c.pct_change(20)
    df["high_low_ratio"] = df["High"] / df["Low"] - 1
    df["price_vs_52w_high"] = c / c.rolling(252).max() - 1

    obv = (v * c.diff().apply(np.sign)).cumsum()
    df["obv_trend"] = obv.diff(20) / (obv.rolling(20).std() + 1e-9)

    df["target"] = (c.shift(-1) > c).astype(int)
    return df


def load_symbol(symbol: str, period: str = "2y") -> pd.DataFrame:
    import yfinance as yf

    df = yf.Ticker(symbol).history(period=period)
    if df.empty:
        raise ValueError(f"No data for {symbol}")
    return build_features(df)

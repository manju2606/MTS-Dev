"""Price regression forecaster — 3 models × 3 horizons → ensemble price targets.

Models : RandomForestRegressor, HistGradientBoostingRegressor, Ridge (all sklearn).
Horizons: 1 day (tomorrow), 5 days (week), 22 days (month).
Trains on 2 years of daily OHLCV from yfinance; results cached 1 hour.
"""

from __future__ import annotations

import asyncio
import time
from datetime import date, timedelta
from functools import partial

import numpy as np
import pandas as pd

from app.domain.models.forecast import HorizonForecast, ModelForecast

_CACHE: dict[str, tuple[list[HorizonForecast], float]] = {}
_CACHE_TTL = 3_600  # 1 hour

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

HORIZONS: list[tuple[str, int]] = [
    ("day", 1),
    ("week", 5),
    ("month", 22),
]


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c, v = df["Close"], df["Volume"]

    df["rsi"] = _compute_rsi(c)
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
    tr = pd.concat(
        [
            df["High"] - df["Low"],
            (df["High"] - c.shift()).abs(),
            (df["Low"] - c.shift()).abs(),
        ],
        axis=1,
    ).max(axis=1)
    df["atr_pct"] = tr.rolling(14).mean() / c
    df["vol_ratio"] = v / v.rolling(20).mean()
    df["ret_1d"] = c.pct_change(1)
    df["ret_5d"] = c.pct_change(5)
    df["ret_20d"] = c.pct_change(20)
    df["high_low_ratio"] = df["High"] / df["Low"] - 1
    df["price_vs_52w_high"] = c / c.rolling(252).max() - 1
    obv = (v * c.diff().apply(np.sign)).cumsum()
    df["obv_trend"] = obv.diff(20) / (obv.rolling(20).std() + 1e-9)
    return df


def _direction(change_pct: float) -> str:
    if change_pct > 0.5:
        return "UP"
    if change_pct < -0.5:
        return "DOWN"
    return "FLAT"


def _next_trade_date(n: int) -> str:
    """Return the date n trading days from today (skips weekends only)."""
    d = date.today()
    added = 0
    while added < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d.isoformat()


def _forecast_sync(symbol: str) -> list[HorizonForecast]:
    import yfinance as yf
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler

    ticker = yf.Ticker(symbol)
    df = ticker.history(period="2y")
    if df.empty or len(df) < 120:
        raise ValueError(f"Insufficient history for {symbol}")

    df = _build_features(df)
    current_price = float(df["Close"].iloc[-1])
    price_std_20 = float(df["Close"].iloc[-20:].std())

    results: list[HorizonForecast] = []

    for horizon_name, horizon_days in HORIZONS:
        target_col = f"_target_{horizon_days}"
        df[target_col] = df["Close"].shift(-horizon_days)

        clean = df.dropna(subset=_FEATURES + [target_col])
        if len(clean) < 60:
            continue

        X = clean[_FEATURES].values
        y = clean[target_col].values

        # Train on 80% of history, leave recent rows for more realistic eval
        split = max(60, int(len(X) * 0.85))
        X_train, y_train = X[:split], y[:split]

        # Latest feature row (most recent complete observation)
        latest_clean = df.dropna(subset=_FEATURES)
        if latest_clean.empty:
            continue
        X_pred_raw = latest_clean.iloc[[-1]][_FEATURES].values

        # RandomForest — no scaling needed
        rf = RandomForestRegressor(n_estimators=80, max_depth=6, random_state=42, n_jobs=-1)
        rf.fit(X_train, y_train)
        rf_pred = float(rf.predict(X_pred_raw)[0])

        # HistGradientBoosting — handles NaN, no scaling needed
        hgb = HistGradientBoostingRegressor(max_iter=80, max_depth=4, random_state=42)
        hgb.fit(X_train, y_train)
        hgb_pred = float(hgb.predict(X_pred_raw)[0])

        # Ridge — needs scaling
        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_pred_s = scaler.transform(X_pred_raw)
        ridge = Ridge(alpha=1.0)
        ridge.fit(X_train_s, y_train)
        ridge_pred = float(ridge.predict(X_pred_s)[0])

        raw_preds = {
            "random_forest": max(rf_pred, 0.01),
            "gradient_boost": max(hgb_pred, 0.01),
            "ridge": max(ridge_pred, 0.01),
        }

        ensemble_price = float(np.mean(list(raw_preds.values())))
        ensemble_price = max(ensemble_price, 0.01)
        pred_std = float(np.std(list(raw_preds.values())))

        model_forecasts: list[ModelForecast] = []
        for mname, mprice in raw_preds.items():
            mpct = (mprice - current_price) / (current_price + 1e-9) * 100
            # Confidence: higher when the model is close to ensemble & ensemble is tight
            spread_ratio = abs(mprice - ensemble_price) / (current_price + 1e-9)
            conf = max(0.3, min(0.95, 1.0 - spread_ratio * 15))
            model_forecasts.append(
                ModelForecast(
                    model=mname,
                    predicted_price=round(mprice, 2),
                    change_pct=round(mpct, 2),
                    confidence=round(conf, 3),
                    direction=_direction(mpct),
                )
            )

        ens_pct = (ensemble_price - current_price) / (current_price + 1e-9) * 100
        band = max(price_std_20, pred_std) * 1.5

        results.append(
            HorizonForecast(
                horizon=horizon_name,
                horizon_days=horizon_days,
                target_date=_next_trade_date(horizon_days),
                ensemble_price=round(ensemble_price, 2),
                ensemble_change_pct=round(ens_pct, 2),
                lower_bound=round(ensemble_price - band, 2),
                upper_bound=round(ensemble_price + band, 2),
                direction=_direction(ens_pct),
                models=model_forecasts,
            )
        )

    return results


async def forecast(symbol: str) -> list[HorizonForecast]:
    cached = _CACHE.get(symbol)
    if cached and (time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, partial(_forecast_sync, symbol))
    _CACHE[symbol] = (result, time.time())
    return result


def invalidate(symbol: str | None = None) -> None:
    if symbol:
        _CACHE.pop(symbol, None)
    else:
        _CACHE.clear()

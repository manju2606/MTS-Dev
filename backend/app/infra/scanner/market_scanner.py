"""Market scanner — scores Nifty 50 universe on momentum and value criteria.

Two-pass approach:
  1. Fast pass: parallel quote fetch for all 50 symbols → compute quick score
  2. Deep pass: full tech indicators for top N candidates
Returns ranked ScanResult list.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from functools import partial

import yfinance as yf

# Nifty 50 universe
NIFTY_50 = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "LT.NS", "AXISBANK.NS", "ASIANPAINT.NS", "MARUTI.NS", "NESTLEIND.NS",
    "TITAN.NS", "SUNPHARMA.NS", "BAJFINANCE.NS", "WIPRO.NS", "HCLTECH.NS",
    "ULTRACEMCO.NS", "BAJAJFINSV.NS", "TECHM.NS", "ONGC.NS", "POWERGRID.NS",
    "NTPC.NS", "COALINDIA.NS", "TATAMOTORS.NS", "TATASTEEL.NS", "JSWSTEEL.NS",
    "ADANIENT.NS", "ADANIPORTS.NS", "DIVISLAB.NS", "CIPLA.NS", "DRREDDY.NS",
    "EICHERMOT.NS", "GRASIM.NS", "HEROMOTOCO.NS", "HINDALCO.NS", "INDUSINDBK.NS",
    "BRITANNIA.NS", "APOLLOHOSP.NS", "BPCL.NS", "TATACONSUM.NS", "SBILIFE.NS",
    "HDFCLIFE.NS", "BAJAJ-AUTO.NS", "UPL.NS", "VEDL.NS", "MM.NS",
]

# Nifty Next 50 additions
NIFTY_NEXT_50_SAMPLE = [
    "PIDILITIND.NS", "HAVELLS.NS", "SIEMENS.NS", "ABB.NS", "BERGEPAINT.NS",
    "COLPAL.NS", "DABUR.NS", "GODREJCP.NS", "MCDOWELL-N.NS", "NAUKRI.NS",
    "DMART.NS", "BAJAJHLDNG.NS", "AMBUJACEM.NS", "GAIL.NS", "INDIGO.NS",
    "TATAPOWER.NS", "CANBK.NS", "PNB.NS", "BANKBARODA.NS", "RECLTD.NS",
]

UNIVERSE = NIFTY_50 + NIFTY_NEXT_50_SAMPLE


@dataclass
class ScanResult:
    symbol: str
    name: str
    price: float
    change_pct: float
    volume: int
    day_high: float
    day_low: float
    week52_high: float
    week52_low: float
    sma20: float
    sma50: float
    rsi: float
    momentum_score: float   # 0–100
    value_score: float      # 0–100
    combined_score: float   # weighted blend
    signal: str             # BUY | SELL | HOLD
    rationale: list[str] = field(default_factory=list)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _fetch_single_sync(symbol: str) -> ScanResult | None:
    import numpy as np

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y")
        if hist.empty or len(hist) < 55:
            return None

        close = hist["Close"]
        volume = hist["Volume"]
        current = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else current
        change_pct = (current - prev) / prev * 100 if prev else 0.0

        sma20 = float(close.rolling(20).mean().iloc[-1])
        sma50 = float(close.rolling(50).mean().iloc[-1])
        week52_high = float(close.max())
        week52_low = float(close.min())

        # RSI (Wilder's)
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(com=13, adjust=False).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = float((100 - 100 / (1 + rs)).iloc[-1])

        vol_avg = float(volume.rolling(20).mean().iloc[-1]) or 1
        vol_ratio = float(volume.iloc[-1]) / vol_avg

        ret_5d = (current / float(close.iloc[-6]) - 1) * 100 if len(close) >= 6 else 0.0
        ret_20d = (current / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else 0.0

        # 52-week position (0 = at low, 1 = at high)
        w52_range = week52_high - week52_low
        w52_pos = (current - week52_low) / w52_range if w52_range else 0.5

        # ── Momentum score ──────────────────────────────────────────────
        mom = 50.0
        # Trend
        if current > sma20 > sma50:
            mom += 15
        elif current > sma20:
            mom += 7
        elif current < sma20 < sma50:
            mom -= 15
        # RSI momentum zone (50–70 is sweet spot for momentum)
        if 50 <= rsi <= 70:
            mom += 12
        elif rsi > 70:
            mom += 5   # overbought — still bullish but stretched
        elif rsi < 40:
            mom -= 10
        # Recent returns
        mom += min(ret_5d * 2, 15)
        mom += min(ret_20d * 0.5, 10)
        # Volume confirmation
        if vol_ratio > 1.5 and change_pct > 0:
            mom += 8
        elif vol_ratio > 1.5 and change_pct < 0:
            mom -= 8
        momentum_score = _clamp(mom)

        # ── Value score ─────────────────────────────────────────────────
        val = 50.0
        # Near 52-week low = value opportunity
        val += (1 - w52_pos) * 30
        # Oversold RSI
        if rsi < 35:
            val += 20
        elif rsi < 45:
            val += 10
        elif rsi > 65:
            val -= 10
        # Price well below SMA20
        pct_vs_sma20 = (current - sma20) / sma20 * 100
        if pct_vs_sma20 < -5:
            val += 15
        elif pct_vs_sma20 < -2:
            val += 8
        value_score = _clamp(val)

        # ── Combined ────────────────────────────────────────────────────
        combined = momentum_score * 0.6 + value_score * 0.4

        # ── Signal ──────────────────────────────────────────────────────
        rationale: list[str] = []
        if combined >= 65:
            signal = "BUY"
        elif combined <= 38:
            signal = "SELL"
        else:
            signal = "HOLD"

        if current > sma20 > sma50:
            rationale.append("SMA 20>50 uptrend")
        elif current < sma20 < sma50:
            rationale.append("SMA 20<50 downtrend")
        if rsi < 35:
            rationale.append(f"RSI {rsi:.0f} — oversold")
        elif rsi > 65:
            rationale.append(f"RSI {rsi:.0f} — overbought")
        if abs(ret_5d) > 3:
            rationale.append(f"{ret_5d:+.1f}% in 5 days")
        if vol_ratio > 1.8:
            rationale.append(f"Vol {vol_ratio:.1f}× avg")

        info = ticker.fast_info
        name = getattr(info, "company_name", symbol.replace(".NS", ""))

        return ScanResult(
            symbol=symbol,
            name=name or symbol.replace(".NS", ""),
            price=round(current, 2),
            change_pct=round(change_pct, 2),
            volume=int(volume.iloc[-1]),
            day_high=round(float(hist["High"].iloc[-1]), 2),
            day_low=round(float(hist["Low"].iloc[-1]), 2),
            week52_high=round(week52_high, 2),
            week52_low=round(week52_low, 2),
            sma20=round(sma20, 2),
            sma50=round(sma50, 2),
            rsi=round(rsi, 1),
            momentum_score=round(momentum_score, 1),
            value_score=round(value_score, 1),
            combined_score=round(combined, 1),
            signal=signal,
            rationale=rationale[:3],
        )
    except Exception:
        return None


async def scan(
    universe: list[str] | None = None,
    filter_type: str = "both",   # momentum | value | both
    limit: int = 20,
) -> list[ScanResult]:
    symbols = universe or UNIVERSE
    loop = asyncio.get_event_loop()

    tasks = [loop.run_in_executor(None, partial(_fetch_single_sync, s)) for s in symbols]
    raw = await asyncio.gather(*tasks)
    results = [r for r in raw if r is not None]

    if filter_type == "momentum":
        results.sort(key=lambda r: -r.momentum_score)
    elif filter_type == "value":
        results.sort(key=lambda r: -r.value_score)
    else:
        results.sort(key=lambda r: -r.combined_score)

    return results[:limit]

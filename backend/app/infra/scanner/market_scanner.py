"""Market scanner — scores Nifty 50 universe on momentum and value criteria.

Two-pass approach:
  1. Fast pass: parallel quote fetch for all 50 symbols → compute quick score
  2. Deep pass: full tech indicators for top N candidates
Returns ranked ScanResult list.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from functools import partial

import yfinance as yf

from app.infra.scanner.universe import NIFTY_500, SYMBOL_SECTOR

UNIVERSE = NIFTY_500


# ── Scan catalog ──────────────────────────────────────────────────────────────

SCAN_CATALOG: list[dict] = [
    # Volume & Breakout
    {"id": "high_volume_breakout", "name": "High Volume Breakout",       "category": "Volume & Breakout", "available": True,  "desc": "Volume > 1.5× average with positive price move"},
    {"id": "price_breakout",       "name": "Price Breakout",             "category": "Volume & Breakout", "available": True,  "desc": "Price within 2% of 52-week high"},
    {"id": "vwap_breakout",        "name": "VWAP Breakout",              "category": "Volume & Breakout", "available": True,  "desc": "Close above intraday VWAP approximation"},
    # Price Action
    {"id": "gap_up",               "name": "Gap Up",                     "category": "Price Action",      "available": True,  "desc": "Opened ≥ 1.5% above previous close"},
    {"id": "gap_down",             "name": "Gap Down",                   "category": "Price Action",      "available": True,  "desc": "Opened ≥ 1.5% below previous close"},
    # Oscillators
    {"id": "rsi_oversold",         "name": "RSI Oversold",               "category": "Oscillators",       "available": True,  "desc": "RSI(14) ≤ 35 — potential bounce zone"},
    {"id": "rsi_overbought",       "name": "RSI Overbought",             "category": "Oscillators",       "available": True,  "desc": "RSI(14) ≥ 65 — stretched, watch for reversal"},
    # Trend
    {"id": "macd_crossover",       "name": "MACD Crossover",             "category": "Trend",             "available": True,  "desc": "MACD histogram flipped positive/negative in last 3 days"},
    {"id": "ma_crossover",         "name": "Moving Average Crossover",   "category": "Trend",             "available": True,  "desc": "20 DMA crossed above 50 DMA (golden cross) in last 5 days"},
    {"id": "bb_breakout",          "name": "Bollinger Band Breakout",    "category": "Trend",             "available": True,  "desc": "Price outside Bollinger Bands (2 SD)"},
    # Momentum
    {"id": "momentum",             "name": "Momentum Stocks",            "category": "Momentum",          "available": True,  "desc": "Top 20-day price performers"},
    {"id": "relative_strength",    "name": "Relative Strength",          "category": "Momentum",          "available": True,  "desc": "Outperforming Nifty 50 over 20 days by ≥ 3%"},
    # Institutional — require premium data
    {"id": "delivery_volume",      "name": "Delivery Volume",            "category": "Institutional",     "available": False, "desc": "High delivery %; requires NSE delivery data API"},
    {"id": "unusual_options",      "name": "Unusual Options Activity",   "category": "Institutional",     "available": False, "desc": "Unusual OI or premium; requires NSE F&O data"},
    {"id": "fii_dii_buying",       "name": "FII / DII Buying",           "category": "Institutional",     "available": False, "desc": "Net institutional inflows; requires NSE bulk data"},
    {"id": "block_deals",          "name": "Block Deals",                "category": "Institutional",     "available": False, "desc": "Large block transactions; requires NSE block deal feed"},
]

SCAN_IDS = {s["id"] for s in SCAN_CATALOG}


# ── Legacy ScanResult (used by market-pulse) ──────────────────────────────────

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
    momentum_score: float
    value_score: float
    combined_score: float
    signal: str
    rationale: list[str] = field(default_factory=list)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


# ── Extended per-stock data fetch (for market scanner) ────────────────────────

def _fetch_scan_data_sync(symbol: str) -> dict | None:
    import numpy as np

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="6mo")
        if hist.empty or len(hist) < 55:
            return None

        close  = hist["Close"]
        high   = hist["High"]
        low    = hist["Low"]
        vol    = hist["Volume"]
        open_  = hist["Open"]

        cur        = float(close.iloc[-1])
        prev_close = float(close.iloc[-2])
        today_open = float(open_.iloc[-1])

        change_pct = (cur - prev_close) / prev_close * 100 if prev_close else 0.0
        gap_pct    = (today_open - prev_close) / prev_close * 100 if prev_close else 0.0

        # Volume
        vol_avg20 = float(vol.rolling(20).mean().iloc[-1]) or 1.0
        vol_ratio = float(vol.iloc[-1]) / vol_avg20

        # Moving averages
        sma20_s = close.rolling(20).mean()
        sma50_s = close.rolling(50).mean()
        sma20   = float(sma20_s.iloc[-1])
        sma50   = float(sma50_s.iloc[-1]) if not np.isnan(sma50_s.iloc[-1]) else sma20

        # RSI (Wilder EMA)
        delta = close.diff()
        gain  = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
        loss  = (-delta.clip(upper=0)).ewm(com=13, adjust=False).mean()
        rs    = gain / loss.replace(0, np.nan)
        rsi   = float((100 - 100 / (1 + rs)).iloc[-1])

        # MACD (12, 26, 9)
        ema12     = close.ewm(span=12, adjust=False).mean()
        ema26     = close.ewm(span=26, adjust=False).mean()
        macd_line = ema12 - ema26
        sig_line  = macd_line.ewm(span=9, adjust=False).mean()
        hist_line = macd_line - sig_line

        macd_cross_up = any(
            float(hist_line.iloc[-(i + 1)]) > 0 and float(hist_line.iloc[-(i + 2)]) <= 0
            for i in range(3)
            if len(hist_line) > i + 2
        )
        macd_cross_dn = any(
            float(hist_line.iloc[-(i + 1)]) < 0 and float(hist_line.iloc[-(i + 2)]) >= 0
            for i in range(3)
            if len(hist_line) > i + 2
        )

        # Bollinger Bands (20, 2)
        bb_mid   = close.rolling(20).mean()
        bb_std   = close.rolling(20).std()
        bb_upper = float((bb_mid + 2 * bb_std).iloc[-1])
        bb_lower = float((bb_mid - 2 * bb_std).iloc[-1])
        bb_range = bb_upper - bb_lower
        bb_pos   = (cur - bb_lower) / bb_range if bb_range > 0 else 0.5

        # VWAP approximation (today's candle)
        vwap = float((high.iloc[-1] + low.iloc[-1] + close.iloc[-1]) / 3)

        # 20-day return
        ret_20d = (cur / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else 0.0

        # 52-week high (from 6mo data — approximate)
        week52_high = float(close.max())
        pct_from_52w = (cur - week52_high) / week52_high * 100

        # MA crossover: SMA20 crossed above SMA50 in last 5 days
        ma_cross_up = False
        if not np.isnan(sma50_s.iloc[-1]) and len(sma50_s.dropna()) >= 5:
            s20 = sma20_s.dropna()
            s50 = sma50_s.dropna()
            common = s20.index.intersection(s50.index)
            if len(common) >= 6:
                a = s20[common].values
                b = s50[common].values
                for i in range(1, min(6, len(a))):
                    if a[-i] > b[-i] and a[-(i + 1)] <= b[-(i + 1)]:
                        ma_cross_up = True
                        break

        info = ticker.fast_info
        name = getattr(info, "company_name", None) or symbol.replace(".NS", "").replace(".BO", "")

        return {
            "symbol":       symbol,
            "name":         name or symbol.split(".")[0],
            "sector":       SYMBOL_SECTOR.get(symbol, "Other"),
            "cmp":          round(cur, 2),
            "prev_close":   round(prev_close, 2),
            "today_open":   round(today_open, 2),
            "change_pct":   round(change_pct, 2),
            "gap_pct":      round(gap_pct, 2),
            "volume":       int(vol.iloc[-1]),
            "vol_avg20":    int(vol_avg20),
            "vol_ratio":    round(vol_ratio, 2),
            "rsi":          round(rsi, 1),
            "macd_cross_up":  macd_cross_up,
            "macd_cross_dn":  macd_cross_dn,
            "macd_val":     round(float(macd_line.iloc[-1]), 4),
            "bb_upper":     round(bb_upper, 2),
            "bb_lower":     round(bb_lower, 2),
            "bb_pos":       round(bb_pos, 3),
            "vwap":         round(vwap, 2),
            "sma20":        round(sma20, 2),
            "sma50":        round(sma50, 2),
            "ret_20d":      round(ret_20d, 2),
            "week52_high":  round(week52_high, 2),
            "pct_from_52w": round(pct_from_52w, 2),
            "ma_cross_up":  ma_cross_up,
        }
    except Exception:
        return None


def _fetch_nifty_ret20_sync() -> float:
    try:
        h = yf.Ticker("^NSEI").history(period="60d")
        if len(h) >= 21:
            return float(h["Close"].iloc[-1] / h["Close"].iloc[-21] - 1) * 100
    except Exception:
        pass
    return 0.0


# ── Universe data cache ───────────────────────────────────────────────────────

_UNIVERSE_CACHE: tuple[list[dict], float] | None = None
_NIFTY_RET_CACHE: tuple[float, float] | None = None
_CACHE_TTL = 300  # 5 minutes


async def _cached_universe_data() -> list[dict]:
    global _UNIVERSE_CACHE
    if _UNIVERSE_CACHE and time.time() - _UNIVERSE_CACHE[1] < _CACHE_TTL:
        return _UNIVERSE_CACHE[0]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, partial(_fetch_scan_data_sync, s)) for s in UNIVERSE]
    raw = await asyncio.gather(*tasks)
    data = [d for d in raw if d is not None]
    _UNIVERSE_CACHE = (data, time.time())
    return data


async def _cached_nifty_ret20() -> float:
    global _NIFTY_RET_CACHE
    if _NIFTY_RET_CACHE and time.time() - _NIFTY_RET_CACHE[1] < _CACHE_TTL:
        return _NIFTY_RET_CACHE[0]
    loop = asyncio.get_event_loop()
    ret = await loop.run_in_executor(None, _fetch_nifty_ret20_sync)
    _NIFTY_RET_CACHE = (ret, time.time())
    return ret


# ── Scan filter logic ─────────────────────────────────────────────────────────

def _apply_filter(rows: list[dict], scan_id: str, nifty_ret20: float) -> list[dict]:
    out: list[dict] = []
    for d in rows:
        d = dict(d)  # shallow copy so we can mutate
        match scan_id:
            case "high_volume_breakout":
                if d["vol_ratio"] >= 1.5 and d["change_pct"] > 0:
                    d["key_metric"] = f"Vol {d['vol_ratio']:.1f}× avg"
                    d["signal"] = "BUY"
                    out.append(d)
            case "price_breakout":
                if d["pct_from_52w"] >= -3.0:
                    d["key_metric"] = f"{d['pct_from_52w']:+.1f}% from 52w High"
                    d["signal"] = "BUY"
                    out.append(d)
            case "vwap_breakout":
                if d["cmp"] > d["vwap"]:
                    d["key_metric"] = f"VWAP ₹{d['vwap']:.0f} ↑"
                    d["signal"] = "BUY"
                    out.append(d)
            case "gap_up":
                if d["gap_pct"] >= 1.5:
                    d["key_metric"] = f"Gap +{d['gap_pct']:.2f}%"
                    d["signal"] = "BUY"
                    out.append(d)
            case "gap_down":
                if d["gap_pct"] <= -1.5:
                    d["key_metric"] = f"Gap {d['gap_pct']:.2f}%"
                    d["signal"] = "SELL"
                    out.append(d)
            case "rsi_oversold":
                if d["rsi"] <= 35:
                    d["key_metric"] = f"RSI {d['rsi']:.0f}"
                    d["signal"] = "BUY"
                    out.append(d)
            case "rsi_overbought":
                if d["rsi"] >= 65:
                    d["key_metric"] = f"RSI {d['rsi']:.0f}"
                    d["signal"] = "SELL"
                    out.append(d)
            case "macd_crossover":
                if d["macd_cross_up"]:
                    d["key_metric"] = "MACD bullish cross"
                    d["signal"] = "BUY"
                    out.append(d)
                elif d["macd_cross_dn"]:
                    d["key_metric"] = "MACD bearish cross"
                    d["signal"] = "SELL"
                    out.append(d)
            case "ma_crossover":
                if d["ma_cross_up"]:
                    d["key_metric"] = f"20D {d['sma20']:.0f} > 50D {d['sma50']:.0f}"
                    d["signal"] = "BUY"
                    out.append(d)
            case "bb_breakout":
                if d["bb_pos"] >= 1.0:
                    d["key_metric"] = f"Above BB ₹{d['bb_upper']:.0f}"
                    d["signal"] = "BUY"
                    out.append(d)
                elif d["bb_pos"] <= 0.0:
                    d["key_metric"] = f"Below BB ₹{d['bb_lower']:.0f}"
                    d["signal"] = "SELL"
                    out.append(d)
            case "momentum":
                if d["ret_20d"] >= 5.0:
                    d["key_metric"] = f"+{d['ret_20d']:.1f}% in 20d"
                    d["signal"] = "BUY"
                    out.append(d)
            case "relative_strength":
                rs = d["ret_20d"] - nifty_ret20
                if rs >= 3.0:
                    d["key_metric"] = f"RS +{rs:.1f}% vs Nifty"
                    d["signal"] = "BUY"
                    out.append(d)
    return out


def _sort_key(scan_id: str) -> str:
    return {
        "high_volume_breakout": "vol_ratio",
        "price_breakout":       "pct_from_52w",
        "vwap_breakout":        "change_pct",
        "gap_up":               "gap_pct",
        "gap_down":             "gap_pct",
        "rsi_oversold":         "rsi",
        "rsi_overbought":       "rsi",
        "macd_crossover":       "macd_val",
        "ma_crossover":         "ret_20d",
        "bb_breakout":          "bb_pos",
        "momentum":             "ret_20d",
        "relative_strength":    "ret_20d",
    }.get(scan_id, "change_pct")


# ── Public API ────────────────────────────────────────────────────────────────

async def run_market_scan(scan_id: str, limit: int = 25) -> dict:
    """Run a named market scan. Returns matching stocks with key_metric and signal."""
    meta = next((s for s in SCAN_CATALOG if s["id"] == scan_id), None)
    if meta is None:
        raise ValueError(f"Unknown scan type: {scan_id!r}")

    if not meta["available"]:
        return {
            "scan_id": scan_id,
            "name": meta["name"],
            "results": [],
            "count": 0,
            "available": False,
            "note": meta.get("desc", "Requires premium data integration"),
            "scanned_at": None,
            "cached": False,
        }

    universe_data, nifty_ret20 = await asyncio.gather(
        _cached_universe_data(),
        _cached_nifty_ret20(),
    )

    cached = _UNIVERSE_CACHE is not None and (time.time() - _UNIVERSE_CACHE[1]) < _CACHE_TTL

    results = _apply_filter(universe_data, scan_id, nifty_ret20)

    key = _sort_key(scan_id)
    reverse = scan_id not in ("rsi_oversold", "gap_down", "bb_breakout")
    results.sort(key=lambda d: d.get(key, 0), reverse=reverse)
    results = results[:limit]

    # Slim output — only fields the frontend needs
    slim = []
    for r in results:
        slim.append({
            "symbol":     r["symbol"],
            "name":       r["name"],
            "sector":     r["sector"],
            "cmp":        r["cmp"],
            "change_pct": r["change_pct"],
            "volume":     r["volume"],
            "vol_ratio":  r["vol_ratio"],
            "rsi":        r["rsi"],
            "key_metric": r.get("key_metric", ""),
            "signal":     r.get("signal", "NEUTRAL"),
        })

    return {
        "scan_id":    scan_id,
        "name":       meta["name"],
        "results":    slim,
        "count":      len(slim),
        "available":  True,
        "note":       None,
        "universe":   len(universe_data),
        "scanned_at": time.time(),
        "cached":     cached,
    }


# ── Legacy scan (used by market-pulse) ───────────────────────────────────────

def _fetch_single_sync(symbol: str) -> ScanResult | None:
    import numpy as np

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y")
        if hist.empty or len(hist) < 55:
            return None

        close  = hist["Close"]
        volume = hist["Volume"]
        current = float(close.iloc[-1])
        prev    = float(close.iloc[-2]) if len(close) > 1 else current
        change_pct = (current - prev) / prev * 100 if prev else 0.0

        sma20       = float(close.rolling(20).mean().iloc[-1])
        sma50       = float(close.rolling(50).mean().iloc[-1])
        week52_high = float(close.max())
        week52_low  = float(close.min())

        delta = close.diff()
        gain  = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
        loss  = (-delta.clip(upper=0)).ewm(com=13, adjust=False).mean()
        rs    = gain / loss.replace(0, np.nan)
        rsi   = float((100 - 100 / (1 + rs)).iloc[-1])

        vol_avg   = float(volume.rolling(20).mean().iloc[-1]) or 1
        vol_ratio = float(volume.iloc[-1]) / vol_avg

        ret_5d  = (current / float(close.iloc[-6])  - 1) * 100 if len(close) >= 6  else 0.0
        ret_20d = (current / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else 0.0

        w52_range = week52_high - week52_low
        w52_pos   = (current - week52_low) / w52_range if w52_range else 0.5

        mom = 50.0
        if current > sma20 > sma50:      mom += 15
        elif current > sma20:             mom += 7
        elif current < sma20 < sma50:    mom -= 15
        if 50 <= rsi <= 70:               mom += 12
        elif rsi > 70:                    mom += 5
        elif rsi < 40:                    mom -= 10
        mom += min(ret_5d * 2, 15)
        mom += min(ret_20d * 0.5, 10)
        if vol_ratio > 1.5 and change_pct > 0:   mom += 8
        elif vol_ratio > 1.5 and change_pct < 0: mom -= 8
        momentum_score = _clamp(mom)

        val = 50.0
        val += (1 - w52_pos) * 30
        if rsi < 35:      val += 20
        elif rsi < 45:    val += 10
        elif rsi > 65:    val -= 10
        pct_vs_sma20 = (current - sma20) / sma20 * 100
        if pct_vs_sma20 < -5:   val += 15
        elif pct_vs_sma20 < -2: val += 8
        value_score = _clamp(val)

        combined = momentum_score * 0.6 + value_score * 0.4

        rationale: list[str] = []
        if combined >= 65:   signal = "BUY"
        elif combined <= 38: signal = "SELL"
        else:                signal = "HOLD"

        if current > sma20 > sma50:  rationale.append("SMA 20>50 uptrend")
        elif current < sma20 < sma50: rationale.append("SMA 20<50 downtrend")
        if rsi < 35:    rationale.append(f"RSI {rsi:.0f} — oversold")
        elif rsi > 65:  rationale.append(f"RSI {rsi:.0f} — overbought")
        if abs(ret_5d) > 3:   rationale.append(f"{ret_5d:+.1f}% in 5 days")
        if vol_ratio > 1.8:   rationale.append(f"Vol {vol_ratio:.1f}× avg")

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
    filter_type: str = "both",
    limit: int = 20,
) -> list[ScanResult]:
    symbols = universe or UNIVERSE
    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(25)  # max 25 concurrent yfinance calls

    async def _fetch(sym: str) -> ScanResult | None:
        async with sem:
            return await loop.run_in_executor(None, partial(_fetch_single_sync, sym))

    raw = await asyncio.gather(*[_fetch(s) for s in symbols])
    results = [r for r in raw if r is not None]

    if filter_type == "momentum":
        results.sort(key=lambda r: -r.momentum_score)
    elif filter_type == "value":
        results.sort(key=lambda r: -r.value_score)
    else:
        results.sort(key=lambda r: -r.combined_score)

    return results[:limit]

"""Golden Stock — Intraday Scanner.

Two-pass scanner over NIFTY_ALL (~750 stocks):
  Pass 1 — Batch yfinance download: compute basic technicals, filter candidates.
  Pass 2 — Full scoring for up to 150 candidates: fetch fundamentals + ADX, score 0-100.

Exported:
  IntradayCandidate, GoldenStockScan, run_golden_stock_scan()
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import partial

import numpy as np
import pandas as pd
import structlog
import yfinance as yf

from app.infra.scanner.universe import NIFTY_ALL, SYMBOL_SECTOR

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class IntradayCandidate:
    rank: int
    symbol: str
    name: str
    sector: str
    entry_price: float
    stop_loss: float
    target_1: float
    target_2: float
    risk_reward: float
    confidence_score: int
    fundamental_score: int
    technical_score: int
    momentum_score: int
    reasons: list[str]
    current_price: float
    change_pct: float
    rsi: float
    adx: float
    volume_ratio: float
    macd_bullish: bool
    near_day_high: bool
    above_sma20: bool
    above_sma50: bool


@dataclass
class GoldenStockScan:
    scan_date: str
    scan_time: str
    universe_scanned: int
    passed_filter: int
    picks: list[IntradayCandidate] = field(default_factory=list)


# ── ADX calculation ───────────────────────────────────────────────────────────

def _compute_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    try:
        tr = pd.concat(
            [high - low, (high - close.shift()).abs(), (low - close.shift()).abs()],
            axis=1,
        ).max(axis=1)
        dm_plus = pd.Series(
            np.where((high.diff() > -low.diff()) & (high.diff() > 0), high.diff(), 0.0),
            index=high.index,
        )
        dm_minus = pd.Series(
            np.where((-low.diff() > high.diff()) & (-low.diff() > 0), -low.diff(), 0.0),
            index=low.index,
        )
        atr = tr.ewm(span=period, adjust=False).mean()
        di_plus = dm_plus.ewm(span=period, adjust=False).mean() / atr.replace(0, np.nan) * 100
        di_minus = dm_minus.ewm(span=period, adjust=False).mean() / atr.replace(0, np.nan) * 100
        denom = (di_plus + di_minus).replace(0, np.nan)
        dx = (di_plus - di_minus).abs() / denom * 100
        adx = dx.ewm(span=period, adjust=False).mean()
        val = float(adx.iloc[-1]) if not adx.empty else 0.0
        return val if not np.isnan(val) else 0.0
    except Exception:
        return 0.0


# ── RSI helper ────────────────────────────────────────────────────────────────

def _compute_rsi(close: pd.Series, period: int = 14) -> float:
    try:
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi_series = 100 - 100 / (1 + rs)
        val = float(rsi_series.iloc[-1])
        return val if not np.isnan(val) else 50.0
    except Exception:
        return 50.0


# ── MACD helper ───────────────────────────────────────────────────────────────

def _macd_bullish_crossover(close: pd.Series) -> bool:
    try:
        if len(close) < 30:
            return False
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()
        hist = macd - signal
        if len(hist) < 4:
            return False
        recent = hist.iloc[-4:]
        return bool(recent.iloc[-1] > 0 and any(v <= 0 for v in recent.iloc[:-1]))
    except Exception:
        return False


# ── Pass 1: batch download ────────────────────────────────────────────────────

def _pass1_batch_download(symbols: list[str]) -> list[dict]:
    """Download 6-month OHLCV for all symbols at once, return filtered candidates."""
    try:
        raw = yf.download(
            symbols,
            period="6mo",
            group_by="ticker",
            threads=True,
            progress=False,
            auto_adjust=True,
        )
    except Exception as exc:
        log.error("golden_stock.pass1.download_error", error=str(exc))
        return []

    candidates: list[dict] = []
    single_sym = len(symbols) == 1

    for sym in symbols:
        try:
            if single_sym:
                df = raw
            else:
                try:
                    df = raw[sym]
                except KeyError:
                    continue

            if df is None or df.empty:
                continue

            close = df["Close"].dropna()
            high_s = df["High"].dropna()
            low_s = df["Low"].dropna()
            volume = df["Volume"].dropna()

            if len(close) < 22:
                continue

            # Detect partial trading day: if today's volume < 30% of 20-day avg,
            # use the previous completed session for current-day metrics.
            vol_avg_hist = float(volume.iloc[:-1].rolling(20).mean().iloc[-1]) if len(volume) > 20 else 1.0
            if pd.isna(vol_avg_hist) or vol_avg_hist == 0:
                vol_avg_hist = 1.0
            today_vol = float(volume.iloc[-1])
            use_prev = today_vol / vol_avg_hist < 0.3

            idx = -2 if use_prev and len(close) >= 2 else -1

            current = float(close.iloc[idx])
            if current <= 0:
                continue

            sma20 = float(close.rolling(20).mean().iloc[idx])
            if pd.isna(sma20):
                continue
            sma50_val = close.rolling(50).mean().iloc[idx]
            sma50 = float(sma50_val) if not pd.isna(sma50_val) else sma20

            rsi = _compute_rsi(close.iloc[:idx] if idx == -2 else close)

            vol_avg = vol_avg_hist
            vol_last = float(volume.iloc[idx])
            volume_ratio = vol_last / vol_avg if vol_avg > 0 else 0.0

            ref_close = close.iloc[:idx] if idx == -2 else close
            ret_5d = (current / float(ref_close.iloc[-6]) - 1) * 100 if len(ref_close) >= 6 else 0.0
            ret_20d = (current / float(ref_close.iloc[-21]) - 1) * 100 if len(ref_close) >= 21 else 0.0

            prev_close = float(close.iloc[idx - 1]) if len(close) >= abs(idx) + 1 else current
            change_pct = (current - prev_close) / prev_close * 100 if prev_close > 0 else 0.0

            day_high = float(high_s.iloc[idx])

            # Pass 1 filter — loose pre-filter; strict filters applied in Pass 2
            if current <= sma20:
                continue
            if not (45 <= rsi <= 85):
                continue
            if volume_ratio < 1.0:
                continue

            candidates.append({
                "symbol": sym,
                "close": close,
                "high": high_s,
                "low": low_s,
                "current": current,
                "sma20": sma20,
                "sma50": sma50,
                "rsi": rsi,
                "volume_ratio": volume_ratio,
                "ret_5d": ret_5d,
                "ret_20d": ret_20d,
                "change_pct": change_pct,
                "day_high": day_high,
            })
        except Exception as exc:
            log.debug("golden_stock.pass1.sym_error", symbol=sym, error=str(exc))
            continue

    return candidates


# ── Pass 2: individual ticker info + scoring ──────────────────────────────────

def _fetch_ticker_info_sync(symbol: str) -> dict:
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        name = (
            info.get("longName")
            or info.get("shortName")
            or symbol.replace(".NS", "")
        )
        return {
            "name": name,
            "returnOnEquity": info.get("returnOnEquity"),
            "debtToEquity": info.get("debtToEquity"),
            "revenueGrowth": info.get("revenueGrowth"),
            "earningsGrowth": info.get("earningsGrowth"),
            "heldPercentInsiders": info.get("heldPercentInsiders"),
            "trailingPE": info.get("trailingPE"),
        }
    except Exception:
        return {"name": symbol.replace(".NS", "")}


def _score_candidate(cand: dict, info: dict) -> IntradayCandidate | None:
    sym = cand["symbol"]
    current = cand["current"]
    sma20 = cand["sma20"]
    sma50 = cand["sma50"]
    rsi = cand["rsi"]
    volume_ratio = cand["volume_ratio"]
    ret_5d = cand["ret_5d"]
    ret_20d = cand["ret_20d"]
    change_pct = cand["change_pct"]
    day_high = cand["day_high"]
    close = cand["close"]
    high_s = cand["high"]
    low_s = cand["low"]

    # SMA200
    above_sma200 = False
    if len(close) >= 200:
        sma200_val = close.rolling(200).mean().iloc[-1]
        above_sma200 = not pd.isna(sma200_val) and current > float(sma200_val)
    elif len(close) >= 50:
        sma200_val = close.rolling(len(close)).mean().iloc[-1]
        above_sma200 = not pd.isna(sma200_val) and current > float(sma200_val)

    above_sma20 = current > sma20
    above_sma50 = current > sma50
    macd_bullish = _macd_bullish_crossover(close)
    adx = _compute_adx(high_s, low_s, close)

    near_day_high = (day_high - current) / day_high * 100 <= 1.5 if day_high > 0 else False

    # 20-day high for breakout
    high_20d_val = close.rolling(20).max().iloc[-1] if len(close) >= 20 else day_high
    high_20d = float(high_20d_val) if not pd.isna(high_20d_val) else day_high
    breakout_20d = (high_20d - current) / high_20d * 100 <= 2.0 if high_20d > 0 else False

    # ── Fundamental score (0-30) ──────────────────────────────────────────────
    fund = 0
    roe = info.get("returnOnEquity")
    de = info.get("debtToEquity")
    rev_growth = info.get("revenueGrowth")
    earn_growth = info.get("earningsGrowth")
    insiders = info.get("heldPercentInsiders")
    pe = info.get("trailingPE")

    if roe is not None:
        if roe > 0.18:
            fund += 6
        elif roe > 0.10:
            fund += 3

    if de is not None:
        if de < 50:
            fund += 5
        elif de < 100:
            fund += 2

    if rev_growth is not None:
        if rev_growth > 0.20:
            fund += 5
        elif rev_growth > 0.10:
            fund += 3

    if earn_growth is not None:
        if earn_growth > 0.25:
            fund += 6
        elif earn_growth > 0.10:
            fund += 3

    if insiders is not None:
        if insiders > 0.50:
            fund += 5
        elif insiders > 0.30:
            fund += 3

    if pe is not None and pe > 0 and pe < 80:
        fund += 3

    fund = min(fund, 30)

    # ── Technical score (0-50) ────────────────────────────────────────────────
    tech = 0
    if above_sma20 and sma20 > sma50:
        tech += 10
        if above_sma200:
            tech += 5
    elif above_sma20:
        tech += 5

    if 60 <= rsi <= 75:
        tech += 10
    elif 55 <= rsi <= 80:
        tech += 5

    if macd_bullish:
        tech += 8

    if adx > 25:
        tech += 7
    elif adx > 20:
        tech += 4

    if volume_ratio >= 2.0:
        tech += 5
    elif volume_ratio >= 1.5:
        tech += 3

    if near_day_high:
        tech += 5

    tech = min(tech, 50)

    # ── Momentum score (0-20) ─────────────────────────────────────────────────
    mom = 0
    if ret_20d > 8:
        mom += 5
    elif ret_20d > 3:
        mom += 3

    if ret_5d > 3:
        mom += 5
    elif ret_5d > 1:
        mom += 2

    if breakout_20d:
        mom += 10

    mom = min(mom, 20)

    total_score = fund + tech + mom

    # ── Intraday hard filters ──────────────────────────────────────────────────
    if total_score < 45:
        return None
    if volume_ratio < 1.5:
        return None
    near_high_2pct = (day_high - current) / day_high * 100 <= 3.0 if day_high > 0 else False
    if not near_high_2pct:
        return None
    if not above_sma20:
        return None

    # ── Entry / SL / Target ───────────────────────────────────────────────────
    entry = round(current, 2)
    stop_loss = round(entry * 0.975, 2)
    target_1 = round(entry * 1.05, 2)
    target_2 = round(entry * 1.08, 2)
    risk = entry - stop_loss
    risk_reward = round((target_1 - entry) / max(risk, 0.01), 2)

    # ── Reasons ───────────────────────────────────────────────────────────────
    reasons: list[str] = []
    reasons.append(f"RSI {rsi:.0f} in bullish momentum zone")
    reasons.append(f"Volume {volume_ratio:.1f}x 20-day average")
    if macd_bullish:
        reasons.append("MACD bullish crossover")
    if adx > 20:
        reasons.append(f"ADX {adx:.0f} — {'strong' if adx > 25 else 'rising'} trend")
    if near_day_high:
        high_pct = (day_high - current) / day_high * 100 if day_high > 0 else 0
        reasons.append(f"Price within {high_pct:.1f}% of day high")
    if breakout_20d:
        reasons.append("Breaking out of 20-day range")
    if above_sma20 and sma20 > sma50:
        reasons.append("Price above SMA20 > SMA50 uptrend")
    if earn_growth is not None and earn_growth > 0.25:
        reasons.append(f"Earnings growth {earn_growth * 100:.0f}%")
    if roe is not None and roe > 0.18:
        reasons.append(f"Strong ROE {roe * 100:.0f}%")

    reasons = reasons[:5]

    name = info.get("name") or sym.replace(".NS", "")
    sector = SYMBOL_SECTOR.get(sym, "Unknown")

    return IntradayCandidate(
        rank=0,
        symbol=sym,
        name=str(name),
        sector=sector,
        entry_price=entry,
        stop_loss=stop_loss,
        target_1=target_1,
        target_2=target_2,
        risk_reward=risk_reward,
        confidence_score=int(total_score),
        fundamental_score=int(fund),
        technical_score=int(tech),
        momentum_score=int(mom),
        reasons=reasons,
        current_price=current,
        change_pct=round(change_pct, 2),
        rsi=round(rsi, 1),
        adx=round(adx, 1),
        volume_ratio=round(volume_ratio, 2),
        macd_bullish=macd_bullish,
        near_day_high=near_day_high,
        above_sma20=above_sma20,
        above_sma50=above_sma50,
    )


# ── Main scan function ────────────────────────────────────────────────────────

async def run_golden_stock_scan() -> GoldenStockScan:
    now_ist = datetime.now(IST)
    scan_date = now_ist.strftime("%Y-%m-%d")
    scan_time = now_ist.isoformat()

    symbols = list(NIFTY_ALL)
    log.info("golden_stock.scan.start", universe=len(symbols))

    # Pass 1 — batch download in executor
    loop = asyncio.get_event_loop()
    candidates = await loop.run_in_executor(None, partial(_pass1_batch_download, symbols))

    pass1_count = len(candidates)
    log.info("golden_stock.pass1.done", candidates=pass1_count)

    # Limit Pass 2 to top 150 by proxy score (RSI + volume_ratio)
    candidates.sort(key=lambda c: -(c["rsi"] * 0.5 + c["volume_ratio"] * 10))
    candidates = candidates[:150]

    # Pass 2 — fetch fundamentals with semaphore
    sem = asyncio.Semaphore(15)

    async def _fetch_and_score(cand: dict) -> IntradayCandidate | None:
        async with sem:
            try:
                info = await loop.run_in_executor(
                    None, partial(_fetch_ticker_info_sync, cand["symbol"])
                )
                return _score_candidate(cand, info)
            except Exception as exc:
                log.debug("golden_stock.pass2.error", symbol=cand["symbol"], error=str(exc))
                return None

    results = await asyncio.gather(*[_fetch_and_score(c) for c in candidates])
    picks_raw = [r for r in results if r is not None]

    # Sort by confidence_score descending, take top 10
    picks_raw.sort(key=lambda p: -p.confidence_score)
    picks_raw = picks_raw[:10]

    for i, pick in enumerate(picks_raw):
        pick.rank = i + 1

    log.info(
        "golden_stock.scan.done",
        universe=len(symbols),
        pass1=pass1_count,
        picks=len(picks_raw),
    )

    return GoldenStockScan(
        scan_date=scan_date,
        scan_time=scan_time,
        universe_scanned=len(symbols),
        passed_filter=pass1_count,
        picks=picks_raw,
    )

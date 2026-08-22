"""Kotegawa Reversal Scanner — mean-reversion picks modeled on Takashi
Kotegawa ("BNF"), a well-known Japanese trader whose publicly documented
style is the opposite of BTST's breakout scanner: buy a liquid stock after
a sharp, high-volume single-day capitulation decline once price has
stretched far below its short moving average (the "kairi"/deviation rate),
betting on a snap-back bounce rather than chasing strength.

Criteria used (only real, computable signals from daily OHLCV — no
fabricated data):
  1. Capitulation decline — single-day drop >= 4%, or a 3-day cumulative
     drop >= 7% (a real "event", not routine chop)
  2. Volume climax — today's volume >= 2.0x the 20-day average (panic-
     selling exhaustion, the clearest computable proxy for capitulation)
  3. Oversold deviation ("kairi") — close at least 10% below its 25-day SMA
  4. Stock-specific weakness vs Nifty — shown/reasoned but NOT a hard
     filter (see _score_candidate) — confirms a single-stock event rather
     than a market-wide selloff, but BNF also traded broad-selloff bounces
  5. Liquidity floor — min ~₹5 crore average daily traded value, since BNF
     specifically avoided stocks he couldn't exit quickly
  6-8. Reversal/stabilization scoring (closed off the lows / hammer candle,
     deeply oversold RSI, no fresh accelerating-decline low) — these decide
     whether a capitulation candidate looks ready to bounce, not just that
     it crashed

Explicitly NOT replicated: BNF's real-time order-book/tape-reading skill
(no L2 depth data in this stack) and any fundamental judgment about
whether a given crash is a genuine overreaction vs justified repricing —
this scanner only captures the quantifiable "buy panic, sell the bounce"
core of his method using end-of-day OHLCV, same honesty scope as
btst_scanner.py's own docstring about its own data gaps.

`run_kotegawa_scan()` also backs the Early Reversal and Intraday sibling
strategies (see kotegawa_early_service.py / kotegawa_intraday_service.py) --
they call this same engine with a different `symbols` universe and/or a
stricter `min_score`, on a repeated intraday cadence instead of once daily
at close. yfinance's daily bar already reflects live intraday O/H/L/Close
during market hours (same fact golden_stock_scanner.py's own 15-min repeat
scan relies on), so no separate intraday data path is needed -- only the
caller's cadence/universe/threshold differs.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import partial

import numpy as np
import pandas as pd
import structlog
import yfinance as yf

from app.infra.scanner.universe import NIFTY_500, SYMBOL_SECTOR

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))
NIFTY_INDEX_SYMBOL = "^NSEI"

MIN_LIQUIDITY_CR = 5.0  # min 20-day average daily traded value, in ₹ crore


# ── Dataclasses ───────────────────────────────────────────────────────────────


@dataclass
class KotegawaCandidate:
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
    capitulation_score: int
    volume_score: int
    kairi_score: int
    reversal_score: int
    reasons: list[str]
    current_price: float
    change_pct: float
    decline_1d_pct: float
    decline_3d_pct: float
    rsi: float
    volume_ratio: float
    kairi_pct: float
    sma25: float
    avg_daily_value_cr: float
    closed_upper_half: bool
    hammer_candle: bool
    relative_weakness_pct: float


@dataclass
class KotegawaScan:
    scan_date: str
    scan_time: str
    universe_scanned: int
    passed_filter: int
    nifty_change_pct: float
    picks: list[KotegawaCandidate] = field(default_factory=list)


# ── Technical helpers (self-contained; mirrors btst_scanner) ──────────────────


def _compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    try:
        tr = pd.concat(
            [high - low, (high - close.shift()).abs(), (low - close.shift()).abs()],
            axis=1,
        ).max(axis=1)
        atr = tr.ewm(span=period, adjust=False).mean()
        val = float(atr.iloc[-1]) if not atr.empty else 0.0
        return val if not np.isnan(val) else 0.0
    except Exception:
        return 0.0


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


# ── Pass 1: batch download + Nifty benchmark ──────────────────────────────────


def _fetch_nifty_change() -> float:
    try:
        df = yf.download(NIFTY_INDEX_SYMBOL, period="5d", progress=False, auto_adjust=True)
        close = df["Close"].dropna()
        if hasattr(close, "iloc") and close.ndim > 1:
            close = close.iloc[:, 0]
        if len(close) < 2:
            return 0.0
        return (float(close.iloc[-1]) / float(close.iloc[-2]) - 1) * 100
    except Exception as exc:
        log.warning("kotegawa.nifty_fetch.error", error=str(exc))
        return 0.0


def _compute_features(
    sym: str, close: pd.Series, high_s: pd.Series, low_s: pd.Series, volume: pd.Series
) -> dict | None:
    """Computes one symbol's capitulation/kairi/volume/reversal feature set
    treating the LAST row of each series as "today" -- callers control what
    "today" means by how much of the series they pass in. The live scan
    (_pass1_batch_download) passes each symbol's full downloaded history
    unchanged (today = the most recent row); the historical backtest
    (kotegawa_historical_backtest_service.py) passes `close.iloc[:i+1]`-style
    truncated slices for day i, with no lookahead, so both paths compute
    identically off a single source of truth. Returns None if there isn't
    enough history yet (SMA25/RSI warmup) -- same as the old inline
    `continue` guards this was extracted from."""
    if len(close) < 30:
        return None

    current = float(close.iloc[-1])
    if current <= 0:
        return None

    today_high = float(high_s.iloc[-1])
    today_low = float(low_s.iloc[-1])

    sma25_val = close.rolling(25).mean().iloc[-1]
    if pd.isna(sma25_val) or sma25_val <= 0:
        return None
    sma25 = float(sma25_val)

    sma5_val = close.rolling(5).mean().iloc[-1]
    sma5 = float(sma5_val) if not pd.isna(sma5_val) else current
    sma10_val = close.rolling(10).mean().iloc[-1]
    sma10 = float(sma10_val) if not pd.isna(sma10_val) else current

    rsi = _compute_rsi(close)

    vol_avg = float(volume.iloc[:-1].rolling(20).mean().iloc[-1]) if len(volume) > 20 else 1.0
    if pd.isna(vol_avg) or vol_avg == 0:
        vol_avg = 1.0
    volume_ratio = float(volume.iloc[-1]) / vol_avg

    avg_daily_value_cr = (
        float((close.iloc[-20:] * volume.iloc[-20:]).mean()) / 1e7 if len(close) >= 20 else 0.0
    )

    prev_close = float(close.iloc[-2]) if len(close) >= 2 else current
    change_pct = (current - prev_close) / prev_close * 100 if prev_close > 0 else 0.0
    decline_1d_pct = change_pct

    close_3d_ago = float(close.iloc[-4]) if len(close) >= 4 else prev_close
    decline_3d_pct = (current - close_3d_ago) / close_3d_ago * 100 if close_3d_ago > 0 else 0.0

    kairi_pct = (current - sma25) / sma25 * 100

    day_range = today_high - today_low
    closed_upper_half = day_range > 0 and (current - today_low) / day_range >= 0.5
    body = abs(current - prev_close)
    lower_wick = min(current, prev_close) - today_low
    hammer_candle = day_range > 0 and lower_wick >= 2 * body and body > 0

    prior_lows = low_s.iloc[-11:-1] if len(low_s) >= 11 else low_s.iloc[:-1]
    recent_low_10d = float(prior_lows.min()) if len(prior_lows) > 0 else today_low
    no_fresh_break = today_low >= recent_low_10d * 0.97

    atr = _compute_atr(high_s, low_s, close)

    return {
        "symbol": sym,
        "current": current,
        "today_low": today_low,
        "sma25": sma25,
        "sma5": sma5,
        "sma10": sma10,
        "rsi": rsi,
        "volume_ratio": volume_ratio,
        "avg_daily_value_cr": avg_daily_value_cr,
        "change_pct": change_pct,
        "decline_1d_pct": decline_1d_pct,
        "decline_3d_pct": decline_3d_pct,
        "kairi_pct": kairi_pct,
        "closed_upper_half": closed_upper_half,
        "hammer_candle": hammer_candle,
        "no_fresh_break": no_fresh_break,
        "atr": atr,
    }


def _pass1_batch_download(symbols: list[str]) -> list[dict]:
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
        log.error("kotegawa.pass1.download_error", error=str(exc))
        return []

    candidates: list[dict] = []
    single_sym = len(symbols) == 1

    for sym in symbols:
        try:
            df = raw if single_sym else raw[sym] if sym in raw.columns.get_level_values(0) else None
            if df is None or df.empty:
                continue

            close = df["Close"].dropna()
            high_s = df["High"].dropna()
            low_s = df["Low"].dropna()
            volume = df["Volume"].dropna()

            features = _compute_features(sym, close, high_s, low_s, volume)
            if features is not None:
                candidates.append(features)
        except Exception as exc:
            log.debug("kotegawa.pass1.sym_error", symbol=sym, error=str(exc))
            continue

    return candidates


def _fetch_name_sync(symbol: str) -> str:
    try:
        info = yf.Ticker(symbol).info or {}
        return str(info.get("longName") or info.get("shortName") or symbol.replace(".NS", ""))
    except Exception:
        return symbol.replace(".NS", "")


# ── Scoring ────────────────────────────────────────────────────────────────────


def _score_candidate(
    cand: dict, name: str, nifty_change_pct: float, min_score: int = 55
) -> KotegawaCandidate | None:
    sym = cand["symbol"]
    current = cand["current"]
    today_low = cand["today_low"]
    sma25 = cand["sma25"]
    sma5 = cand["sma5"]
    sma10 = cand["sma10"]
    rsi = cand["rsi"]
    volume_ratio = cand["volume_ratio"]
    avg_daily_value_cr = cand["avg_daily_value_cr"]
    change_pct = cand["change_pct"]
    decline_1d_pct = cand["decline_1d_pct"]
    decline_3d_pct = cand["decline_3d_pct"]
    kairi_pct = cand["kairi_pct"]
    closed_upper_half = cand["closed_upper_half"]
    hammer_candle = cand["hammer_candle"]
    no_fresh_break = cand["no_fresh_break"]
    atr = cand["atr"]

    # ── Hard filters — capitulation candidate must actually qualify ──────────
    capitulated = decline_1d_pct <= -4.0 or decline_3d_pct <= -7.0
    volume_climax = volume_ratio >= 2.0
    oversold = kairi_pct <= -10.0
    liquid = avg_daily_value_cr >= MIN_LIQUIDITY_CR

    if not (capitulated and volume_climax and oversold and liquid):
        return None

    relative_weakness_pct = change_pct - nifty_change_pct

    # ── Capitulation magnitude (0-30) ─────────────────────────────────────────
    worst_decline = min(decline_1d_pct, decline_3d_pct)
    if worst_decline <= -15:
        capitulation_score = 30
    elif worst_decline <= -10:
        capitulation_score = 24
    elif worst_decline <= -7:
        capitulation_score = 18
    else:
        capitulation_score = 12

    # ── Volume climax (0-25) ──────────────────────────────────────────────────
    if volume_ratio >= 5.0:
        volume_score = 25
    elif volume_ratio >= 3.5:
        volume_score = 20
    elif volume_ratio >= 2.5:
        volume_score = 15
    else:
        volume_score = 10

    # ── Oversold kairi (0-25) ─────────────────────────────────────────────────
    if kairi_pct <= -25:
        kairi_score = 25
    elif kairi_pct <= -18:
        kairi_score = 20
    elif kairi_pct <= -14:
        kairi_score = 15
    else:
        kairi_score = 10

    # ── Reversal / stabilization (0-20) ───────────────────────────────────────
    reversal_score = 0
    if closed_upper_half or hammer_candle:
        reversal_score += 10
    if rsi <= 25:
        reversal_score += 7
    elif rsi <= 35:
        reversal_score += 3
    if no_fresh_break:
        reversal_score += 3
    reversal_score = min(reversal_score, 20)

    total_score = capitulation_score + volume_score + kairi_score + reversal_score

    if total_score < min_score:
        return None

    # Entry / SL / Targets — sized to the stock's own ATR and recent SMAs,
    # not a flat percentage. Stop below today's low (the capitulation low):
    # a break of it means the decline hasn't actually stopped.
    entry = round(current, 2)
    stop_loss = round(today_low - 0.3 * atr, 2) if atr > 0 else round(today_low * 0.98, 2)
    stop_loss = min(stop_loss, entry - 0.01)

    atr_target1 = entry + 1.5 * atr if atr > 0 else entry * 1.02
    t1_candidates = [t for t in (sma5, atr_target1) if t > entry]
    target_1 = round(min(t1_candidates), 2) if t1_candidates else round(atr_target1, 2)

    atr_target2 = entry + 2.5 * atr if atr > 0 else entry * 1.035
    t2_candidates = [t for t in (sma10, atr_target2) if t > target_1]
    target_2 = round(max(t2_candidates), 2) if t2_candidates else round(atr_target2, 2)

    risk = entry - stop_loss
    risk_reward = round((target_1 - entry) / max(risk, 0.01), 2)

    reasons: list[str] = []
    if decline_1d_pct <= -4.0:
        reasons.append(f"Single-day capitulation decline of {decline_1d_pct:.1f}%")
    elif decline_3d_pct <= -7.0:
        reasons.append(f"3-day cumulative decline of {decline_3d_pct:.1f}%")
    reasons.append(f"Volume climax {volume_ratio:.1f}x 20-day average")
    reasons.append(f"{abs(kairi_pct):.1f}% below 25-day SMA (oversold deviation)")
    if closed_upper_half:
        reasons.append("Closed in upper half of the day's range (selling exhaustion)")
    if hammer_candle:
        reasons.append("Hammer-like reversal candle (long lower wick)")
    if rsi <= 35:
        reasons.append(f"RSI deeply oversold at {rsi:.1f}")
    if relative_weakness_pct < -1:
        reasons.append(
            f"Stock-specific event: {relative_weakness_pct:.1f}% weaker than Nifty today"
        )
    reasons = reasons[:6]

    sector = SYMBOL_SECTOR.get(sym, "Unknown")

    return KotegawaCandidate(
        rank=0,
        symbol=sym,
        name=name,
        sector=sector,
        entry_price=entry,
        stop_loss=stop_loss,
        target_1=target_1,
        target_2=target_2,
        risk_reward=risk_reward,
        confidence_score=int(total_score),
        capitulation_score=int(capitulation_score),
        volume_score=int(volume_score),
        kairi_score=int(kairi_score),
        reversal_score=int(reversal_score),
        reasons=reasons,
        current_price=current,
        change_pct=round(change_pct, 2),
        decline_1d_pct=round(decline_1d_pct, 2),
        decline_3d_pct=round(decline_3d_pct, 2),
        rsi=round(rsi, 1),
        volume_ratio=round(volume_ratio, 2),
        kairi_pct=round(kairi_pct, 2),
        sma25=round(sma25, 2),
        avg_daily_value_cr=round(avg_daily_value_cr, 2),
        closed_upper_half=closed_upper_half,
        hammer_candle=hammer_candle,
        relative_weakness_pct=round(relative_weakness_pct, 2),
    )


# ── Main scan function ────────────────────────────────────────────────────────


async def run_kotegawa_scan(
    symbols: list[str] | None = None, min_score: int = 55
) -> KotegawaScan:
    """symbols/min_score let Early Reversal and Intraday reuse this same
    engine (see module docstring) -- symbols defaults to the full NIFTY 500
    Reversal scans, min_score defaults to Reversal's own 55 gate."""
    now_ist = datetime.now(IST)
    scan_date = now_ist.strftime("%Y-%m-%d")
    scan_time = now_ist.isoformat()

    symbols = list(symbols) if symbols is not None else list(NIFTY_500)
    log.info("kotegawa.scan.start", universe=len(symbols))

    loop = asyncio.get_event_loop()

    nifty_change_pct = await loop.run_in_executor(None, _fetch_nifty_change)
    candidates = await loop.run_in_executor(None, partial(_pass1_batch_download, symbols))
    pass1_count = len(candidates)
    log.info("kotegawa.pass1.done", candidates=pass1_count)

    # Cheap pre-filter before spending API calls on name enrichment
    prelim = [
        c
        for c in candidates
        if (c["decline_1d_pct"] <= -4.0 or c["decline_3d_pct"] <= -7.0)
        and c["volume_ratio"] >= 2.0
        and c["kairi_pct"] <= -10.0
        and c["avg_daily_value_cr"] >= MIN_LIQUIDITY_CR
    ]
    prelim.sort(key=lambda c: c["kairi_pct"])
    prelim = prelim[:40]

    sem = asyncio.Semaphore(10)

    async def _enrich_and_score(cand: dict) -> KotegawaCandidate | None:
        async with sem:
            try:
                name = await loop.run_in_executor(None, partial(_fetch_name_sync, cand["symbol"]))
                return _score_candidate(cand, name, nifty_change_pct, min_score)
            except Exception as exc:
                log.debug("kotegawa.pass2.error", symbol=cand["symbol"], error=str(exc))
                return None

    results = await asyncio.gather(*[_enrich_and_score(c) for c in prelim])
    picks_raw = [r for r in results if r is not None]

    picks_raw.sort(key=lambda p: -p.confidence_score)
    picks_raw = picks_raw[:10]
    for i, pick in enumerate(picks_raw):
        pick.rank = i + 1

    log.info(
        "kotegawa.scan.done",
        universe=len(symbols),
        pass1=pass1_count,
        picks=len(picks_raw),
        nifty_change_pct=nifty_change_pct,
    )

    return KotegawaScan(
        scan_date=scan_date,
        scan_time=scan_time,
        universe_scanned=len(symbols),
        passed_filter=pass1_count,
        nifty_change_pct=round(nifty_change_pct, 2),
        picks=picks_raw,
    )

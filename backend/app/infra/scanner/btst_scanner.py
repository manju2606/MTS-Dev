"""BTST (Buy Today, Sell Tomorrow) Scanner.

Unlike Golden Stock Intraday (same-session entry/exit), BTST picks are held
overnight and sold the next trading day. A reliable BTST candidate needs more
than a single day's momentum — it needs conviction that a gap-up is likely.

Criteria used (only real, computable signals — no fabricated data):
  1. Breakout from a multi-week consolidation range (tight prior base, new high)
  2. High volume vs 20-day average (proxy for delivery-based buying interest —
     NSE delivery %% is not available via the current data provider)
  3. Relative strength vs Nifty (stock return vs ^NSEI return, 5D & 20D)
  4. Positive news sentiment (real RSS feed + sentiment scoring, symbol-matched)
  5. Bullish F&O positioning (Put/Call OI ratio from yfinance options chain,
     only for F&O-enabled stocks — most mid/small caps won't have this)

FII/DII cash-market buying is NOT included: no free/live data source for
per-stock institutional flow is integrated in this stack, and fabricating a
number would be presenting false data as real. If that feed is ever wired up,
it slots in alongside the other factors below.
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
NIFTY_INDEX_SYMBOL = "^NSEI"


# ── Dataclasses ───────────────────────────────────────────────────────────────


@dataclass
class BTSTCandidate:
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
    breakout_score: int
    relative_strength_score: int
    volume_score: int
    news_score: int
    fo_score: int
    reasons: list[str]
    current_price: float
    change_pct: float
    rsi: float
    volume_ratio: float
    breakout_consolidation: bool
    consolidation_days: int
    relative_strength_5d: float
    relative_strength_20d: float
    news_sentiment: float | None
    news_mentions: int
    pcr: float | None
    fo_bullish: bool
    above_sma20: bool
    above_sma50: bool


@dataclass
class BTSTScan:
    scan_date: str
    scan_time: str
    universe_scanned: int
    passed_filter: int
    nifty_ret_5d: float
    nifty_ret_20d: float
    picks: list[BTSTCandidate] = field(default_factory=list)


# ── Technical helpers (self-contained; mirrors golden_stock_scanner) ──────────


def _compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    """Wilder's ATR — used to size stop-loss/target to the stock's own volatility
    instead of a flat percentage."""
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


def _detect_consolidation_breakout(close: pd.Series, lookback: int = 15) -> tuple[bool, int]:
    """Detect a breakout above a tight multi-week consolidation range.

    A "consolidation" is a `lookback`-day window (excluding today) where the
    trading range is unusually tight (< 8%% high-low spread). A breakout is
    today's close pushing above that prior range's high.
    """
    try:
        if len(close) < lookback + 2:
            return False, 0
        prior = close.iloc[-(lookback + 1) : -1]
        prior_high = float(prior.max())
        prior_low = float(prior.min())
        if prior_high <= 0:
            return False, 0
        range_pct = (prior_high - prior_low) / prior_high * 100
        current = float(close.iloc[-1])
        is_tight = range_pct <= 8.0
        breakout = current > prior_high
        return bool(is_tight and breakout), lookback
    except Exception:
        return False, 0


# ── Pass 1: batch download + Nifty benchmark ──────────────────────────────────


def _fetch_nifty_returns() -> tuple[float, float]:
    try:
        df = yf.download(NIFTY_INDEX_SYMBOL, period="3mo", progress=False, auto_adjust=True)
        close = df["Close"].dropna()
        if hasattr(close, "iloc") and close.ndim > 1:
            close = close.iloc[:, 0]
        if len(close) < 21:
            return 0.0, 0.0
        current = float(close.iloc[-1])
        ret_5d = (current / float(close.iloc[-6]) - 1) * 100 if len(close) >= 6 else 0.0
        ret_20d = (current / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else 0.0
        return ret_5d, ret_20d
    except Exception as exc:
        log.warning("btst.nifty_fetch.error", error=str(exc))
        return 0.0, 0.0


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
        log.error("btst.pass1.download_error", error=str(exc))
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
            if len(close) < 30:
                continue

            current = float(close.iloc[-1])
            if current <= 0:
                continue

            sma20 = float(close.rolling(20).mean().iloc[-1])
            if pd.isna(sma20):
                continue
            sma50_val = close.rolling(50).mean().iloc[-1]
            sma50 = float(sma50_val) if not pd.isna(sma50_val) else sma20

            rsi = _compute_rsi(close)
            vol_avg = (
                float(volume.iloc[:-1].rolling(20).mean().iloc[-1]) if len(volume) > 20 else 1.0
            )
            if pd.isna(vol_avg) or vol_avg == 0:
                vol_avg = 1.0
            volume_ratio = float(volume.iloc[-1]) / vol_avg

            ret_5d = (current / float(close.iloc[-6]) - 1) * 100 if len(close) >= 6 else 0.0
            ret_20d = (current / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else 0.0

            prev_close = float(close.iloc[-2]) if len(close) >= 2 else current
            change_pct = (current - prev_close) / prev_close * 100 if prev_close > 0 else 0.0

            breakout, cons_days = _detect_consolidation_breakout(close)

            if current <= sma20:
                continue
            if volume_ratio < 1.2:
                continue

            candidates.append(
                {
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
                    "breakout": breakout,
                    "cons_days": cons_days,
                }
            )
        except Exception as exc:
            log.debug("btst.pass1.sym_error", symbol=sym, error=str(exc))
            continue

    return candidates


# ── News sentiment lookup ──────────────────────────────────────────────────────


async def _build_news_sentiment_map() -> dict[str, tuple[float, int]]:
    """symbol -> (avg_sentiment, mention_count), built from live RSS feeds."""
    try:
        from app.infra.discovery.news_fetcher import fetch_all_news

        items = await fetch_all_news()
    except Exception as exc:
        log.warning("btst.news.error", error=str(exc))
        return {}

    scores: dict[str, list[float]] = {}
    for item in items:
        for sym in item.mentioned_symbols:
            scores.setdefault(sym, []).append(item.sentiment_score)

    return {sym: (sum(v) / len(v), len(v)) for sym, v in scores.items()}


# ── F&O positioning (PCR from yfinance options chain) ─────────────────────────


def _fetch_pcr_sync(symbol: str) -> float | None:
    try:
        ticker = yf.Ticker(symbol)
        expiries = ticker.options
        if not expiries:
            return None
        chain = ticker.option_chain(expiries[0])
        call_oi = float(chain.calls["openInterest"].fillna(0).sum())
        put_oi = float(chain.puts["openInterest"].fillna(0).sum())
        if call_oi <= 0:
            return None
        return round(put_oi / call_oi, 2)
    except Exception:
        return None


def _fetch_name_sync(symbol: str) -> str:
    try:
        info = yf.Ticker(symbol).info or {}
        return str(info.get("longName") or info.get("shortName") or symbol.replace(".NS", ""))
    except Exception:
        return symbol.replace(".NS", "")


# ── Scoring ────────────────────────────────────────────────────────────────────


def _score_candidate(
    cand: dict,
    name: str,
    nifty_ret_5d: float,
    nifty_ret_20d: float,
    news: tuple[float, int] | None,
    pcr: float | None,
) -> BTSTCandidate | None:
    sym = cand["symbol"]
    current = cand["current"]
    sma20 = cand["sma20"]
    sma50 = cand["sma50"]
    rsi = cand["rsi"]
    volume_ratio = cand["volume_ratio"]
    ret_5d = cand["ret_5d"]
    ret_20d = cand["ret_20d"]
    change_pct = cand["change_pct"]
    close = cand["close"]
    high_s = cand["high"]
    low_s = cand["low"]
    breakout = cand["breakout"]
    cons_days = cand["cons_days"]

    above_sma20 = current > sma20
    above_sma50 = current > sma50
    macd_bullish = _macd_bullish_crossover(close)

    rel_5d = ret_5d - nifty_ret_5d
    rel_20d = ret_20d - nifty_ret_20d

    news_sentiment = news[0] if news else None
    news_mentions = news[1] if news else 0
    fo_bullish = pcr is not None and pcr < 1.0

    # ── Breakout / technical score (0-40) ─────────────────────────────────────
    breakout_score = 0
    if breakout:
        breakout_score += 20
    if above_sma20 and sma20 > sma50:
        breakout_score += 8
    if 55 <= rsi <= 75:
        breakout_score += 7
    if macd_bullish:
        breakout_score += 5
    breakout_score = min(breakout_score, 40)

    # ── Relative strength vs Nifty (0-20) ─────────────────────────────────────
    rel_score = 0
    if rel_5d > 3:
        rel_score += 10
    elif rel_5d > 1:
        rel_score += 5
    if rel_20d > 5:
        rel_score += 10
    elif rel_20d > 2:
        rel_score += 5
    rel_score = min(rel_score, 20)

    # ── Volume / delivery proxy (0-15) ────────────────────────────────────────
    vol_score = 0
    if volume_ratio >= 2.5:
        vol_score = 15
    elif volume_ratio >= 2.0:
        vol_score = 10
    elif volume_ratio >= 1.5:
        vol_score = 6

    # ── News sentiment (0-15) ─────────────────────────────────────────────────
    news_score = 0
    if news_sentiment is not None and news_mentions > 0:
        if news_sentiment > 0.3:
            news_score = 15
        elif news_sentiment > 0.1:
            news_score = 8
        elif news_sentiment > 0:
            news_score = 4

    # ── F&O positioning (0-10) ────────────────────────────────────────────────
    fo_score = 0
    if pcr is not None:
        if pcr < 0.7:
            fo_score = 10
        elif pcr < 1.0:
            fo_score = 6

    total_score = breakout_score + rel_score + vol_score + news_score + fo_score

    # ── BTST hard filters — overnight hold needs real conviction ─────────────
    if not breakout:
        return None
    if total_score < 45:
        return None
    if not above_sma20:
        return None
    if rel_5d <= 0 and rel_20d <= 0:
        return None

    # Entry / SL / Target — sized to the stock's own ATR-14, not a flat %.
    # BTST holds overnight, so allow a slightly wider band than same-session Intraday.
    entry = round(current, 2)
    atr = _compute_atr(high_s, low_s, close)
    atr_pct = (atr / current * 100) if current > 0 and atr > 0 else 3.0
    atr_pct = min(max(atr_pct, 1.5), 6.0)
    stop_loss = round(entry * (1 - atr_pct / 100), 2)
    target_1 = round(entry * (1 + 2 * atr_pct / 100), 2)
    target_2 = round(entry * (1 + 3 * atr_pct / 100), 2)
    risk = entry - stop_loss
    risk_reward = round((target_1 - entry) / max(risk, 0.01), 2)

    reasons: list[str] = [f"Breakout from {cons_days}-day tight consolidation range"]
    reasons.append(f"Volume {volume_ratio:.1f}x 20-day average (delivery proxy)")
    if rel_5d > 0:
        reasons.append(f"Relative strength vs Nifty: {rel_5d:+.1f}% (5D)")
    if rel_20d > 0:
        reasons.append(f"Relative strength vs Nifty: {rel_20d:+.1f}% (20D)")
    if news_sentiment is not None and news_mentions > 0:
        plural = "s" if news_mentions != 1 else ""
        reasons.append(f"Positive news sentiment ({news_mentions} recent mention{plural})")
    if fo_bullish and pcr is not None:
        reasons.append(f"Bullish F&O positioning (PCR {pcr:.2f})")
    if macd_bullish:
        reasons.append("MACD bullish crossover")
    reasons = reasons[:6]

    sector = SYMBOL_SECTOR.get(sym, "Unknown")

    return BTSTCandidate(
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
        breakout_score=int(breakout_score),
        relative_strength_score=int(rel_score),
        volume_score=int(vol_score),
        news_score=int(news_score),
        fo_score=int(fo_score),
        reasons=reasons,
        current_price=current,
        change_pct=round(change_pct, 2),
        rsi=round(rsi, 1),
        volume_ratio=round(volume_ratio, 2),
        breakout_consolidation=breakout,
        consolidation_days=cons_days,
        relative_strength_5d=round(rel_5d, 2),
        relative_strength_20d=round(rel_20d, 2),
        news_sentiment=round(news_sentiment, 2) if news_sentiment is not None else None,
        news_mentions=news_mentions,
        pcr=pcr,
        fo_bullish=fo_bullish,
        above_sma20=above_sma20,
        above_sma50=above_sma50,
    )


# ── Main scan function ────────────────────────────────────────────────────────


async def run_btst_scan() -> BTSTScan:
    now_ist = datetime.now(IST)
    scan_date = now_ist.strftime("%Y-%m-%d")
    scan_time = now_ist.isoformat()

    symbols = list(NIFTY_ALL)
    log.info("btst.scan.start", universe=len(symbols))

    loop = asyncio.get_event_loop()

    nifty_ret_5d, nifty_ret_20d = await loop.run_in_executor(None, _fetch_nifty_returns)
    candidates = await loop.run_in_executor(None, partial(_pass1_batch_download, symbols))
    pass1_count = len(candidates)
    log.info("btst.pass1.done", candidates=pass1_count)

    # Keep only genuine consolidation breakouts before spending API calls on enrichment
    candidates = [c for c in candidates if c["breakout"]]
    candidates.sort(key=lambda c: -(c["ret_5d"] - nifty_ret_5d))
    candidates = candidates[:40]

    news_map = await _build_news_sentiment_map()

    sem = asyncio.Semaphore(10)

    async def _enrich_and_score(cand: dict) -> BTSTCandidate | None:
        async with sem:
            try:
                name, pcr = await asyncio.gather(
                    loop.run_in_executor(None, partial(_fetch_name_sync, cand["symbol"])),
                    loop.run_in_executor(None, partial(_fetch_pcr_sync, cand["symbol"])),
                )
                news = news_map.get(cand["symbol"])
                return _score_candidate(cand, name, nifty_ret_5d, nifty_ret_20d, news, pcr)
            except Exception as exc:
                log.debug("btst.pass2.error", symbol=cand["symbol"], error=str(exc))
                return None

    results = await asyncio.gather(*[_enrich_and_score(c) for c in candidates])
    picks_raw = [r for r in results if r is not None]

    picks_raw.sort(key=lambda p: -p.confidence_score)
    picks_raw = picks_raw[:10]
    for i, pick in enumerate(picks_raw):
        pick.rank = i + 1

    log.info(
        "btst.scan.done",
        universe=len(symbols),
        pass1=pass1_count,
        picks=len(picks_raw),
        nifty_ret_5d=nifty_ret_5d,
        nifty_ret_20d=nifty_ret_20d,
    )

    return BTSTScan(
        scan_date=scan_date,
        scan_time=scan_time,
        universe_scanned=len(symbols),
        passed_filter=pass1_count,
        nifty_ret_5d=round(nifty_ret_5d, 2),
        nifty_ret_20d=round(nifty_ret_20d, 2),
        picks=picks_raw,
    )

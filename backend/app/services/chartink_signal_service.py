"""Chartink Signal Engine.

Scores every candidate a Chartink scan-alert webhook sends -- unlike Golden
Stock Intraday's scorer (golden_stock_scanner.py), nothing here hard-rejects
a candidate for not fitting a bullish-momentum profile, since your Chartink
scans may represent different strategies (breakout, reversal, ...). A weak
technical picture just scores a low confidence instead of getting dropped.

Reuses fetch_technicals() and the indicator math (_compute_atr/_compute_adx/
_macd_bullish_crossover) from golden_stock_scanner.py -- that's the proven,
already-tested data-fetch + indicator computation, just without Golden
Stock's own filter/weighting applied on top.

Every candidate fills the AI recommendation schema mandated in CLAUDE.md
(signal/confidence/entry_price/stop_loss/target/risk_reward_ratio/
holding_period/explanation). signal is fixed to "BUY" -- cash-equity-only,
same no-shorting convention as Golden Egg/Golden Stock.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from functools import partial
from uuid import uuid4

import structlog

from app.domain.models.chartink_breakout_alert import ChartinkBreakoutAlert
from app.domain.models.chartink_candidate import ChartinkCandidate
from app.domain.models.chartink_scoring_config import ChartinkScoringConfig
from app.infra.scanner.golden_stock_scanner import (
    _compute_adx,
    _compute_atr,
    _macd_bullish_crossover,
    fetch_technicals,
)

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


def _confidence_and_explanation(
    c: dict, adx: float, macd_bullish: bool, cfg: ChartinkScoringConfig
) -> tuple[float, str]:
    """General-purpose 0.0-1.0 confidence score. cfg's five components are
    meant to sum to 1.0 across RSI zone / ADX / volume / MACD / trend at
    their respective maximums -- none of them hard-reject. See
    /api/v1/chartink/config (admin-editable) for the live values."""
    rsi = c["rsi"]
    volume_ratio = c["volume_ratio"]

    if cfg.rsi_healthy_min <= rsi <= cfg.rsi_healthy_max:
        rsi_score, rsi_note = cfg.rsi_healthy_score, f"RSI {rsi:.0f} in a healthy bullish zone"
    elif (cfg.rsi_healthy_min - 15) <= rsi < cfg.rsi_healthy_min or (
        cfg.rsi_healthy_max < rsi <= (cfg.rsi_healthy_max + 10)
    ):
        rsi_score, rsi_note = cfg.rsi_moderate_score, f"RSI {rsi:.0f} — moderate"
    else:
        rsi_score, rsi_note = cfg.rsi_extended_score, f"RSI {rsi:.0f} — extended"

    if adx > cfg.adx_strong_threshold:
        adx_score, adx_note = cfg.adx_strong_score, f"ADX {adx:.0f} — strong trend"
    elif adx > cfg.adx_rising_threshold:
        adx_score, adx_note = cfg.adx_rising_score, f"ADX {adx:.0f} — rising trend"
    else:
        adx_score, adx_note = cfg.adx_weak_score, f"ADX {adx:.0f} — weak/no trend"

    if volume_ratio >= cfg.vol_strong_threshold:
        vol_score = cfg.vol_strong_score
    elif volume_ratio >= cfg.vol_moderate_threshold:
        vol_score = cfg.vol_moderate_score
    elif volume_ratio >= cfg.vol_mild_threshold:
        vol_score = cfg.vol_mild_score
    else:
        vol_score = cfg.vol_weak_score
    vol_note = f"volume {volume_ratio:.1f}x 20-day average"

    macd_score = cfg.macd_bullish_score if macd_bullish else 0.0
    trend_score = cfg.trend_score if c["current"] > c["sma20"] > c["sma50"] else 0.0

    confidence = round(min(rsi_score + adx_score + vol_score + macd_score + trend_score, 1.0), 2)

    notes = [rsi_note, adx_note, vol_note]
    if macd_bullish:
        notes.append("MACD bullish crossover")
    if trend_score:
        notes.append("price above SMA20 > SMA50 uptrend")
    explanation = "Chartink scan match — " + "; ".join(notes) + "."

    return confidence, explanation


def _size_entry_sl_target(c: dict, cfg: ChartinkScoringConfig) -> tuple[float, float, float, float]:
    """ATR-14 sized entry/stop-loss/target -- same 1x/1.5x-ATR approach as
    Golden Stock Intraday's proven sizing math (re-derived here rather than
    imported since it's a small, self-contained block private to that
    module)."""
    current = c["current"]
    atr = _compute_atr(c["high"], c["low"], c["close"])
    atr_pct = (atr / current * 100) if current > 0 and atr > 0 else 2.5
    # clamp: avoid degenerate too-tight/too-wide bands
    atr_pct = min(max(atr_pct, cfg.atr_min_pct), cfg.atr_max_pct)

    entry = round(current, 2)
    stop_loss = round(entry * (1 - atr_pct / 100), 2)
    target = round(entry * (1 + cfg.atr_target_multiplier * atr_pct / 100), 2)
    risk = entry - stop_loss
    risk_reward_ratio = round((target - entry) / max(risk, 0.01), 2)
    return entry, stop_loss, target, risk_reward_ratio


async def _fetch_technicals_async(symbols: list[str]) -> list[dict]:
    """fetch_technicals() is a blocking yfinance call -- offload it so this
    coroutine doesn't block the event loop, same pattern as every other
    yfinance-backed service in this codebase."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(fetch_technicals, symbols))


def _fetch_market_cap_sync(symbol: str) -> float | None:
    try:
        import yfinance as yf

        return yf.Ticker(symbol).fast_info.market_cap
    except Exception:
        return None


async def _fetch_market_caps(symbols: list[str]) -> dict[str, float | None]:
    """market_cap isn't in the batch yfinance download fetch_technicals()
    uses (price/volume history only) -- needs one fast_info call per
    symbol. Only called for symbols that just crossed the breakout
    streak threshold (a handful per detection event, not every scan
    candidate), concurrency-bounded the same way Golden Stock's Pass 2
    fundamentals fetch is (see run_golden_stock_scan)."""
    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(15)

    async def _one(sym: str) -> tuple[str, float | None]:
        async with sem:
            cap = await loop.run_in_executor(None, _fetch_market_cap_sync, sym)
            return sym, cap

    results = await asyncio.gather(*[_one(s) for s in symbols])
    return dict(results)


async def preview_score(symbol: str, cfg: ChartinkScoringConfig) -> dict:
    """Score one live symbol against a caller-supplied config -- doesn't
    touch the DB or send email, unlike process_chartink_alert(). Lets the
    admin-editable /chartink/config panel show what a candidate's score
    would look like under draft (not-yet-saved) parameter values before
    committing them."""
    technicals = await _fetch_technicals_async([symbol])
    if not technicals:
        raise ValueError(f"No technical data available for {symbol}")

    c = technicals[0]
    adx = _compute_adx(c["high"], c["low"], c["close"])
    macd_bullish = _macd_bullish_crossover(c["close"])
    confidence, explanation = _confidence_and_explanation(c, adx, macd_bullish, cfg)
    entry, stop_loss, target, rr = _size_entry_sl_target(c, cfg)

    return {
        "symbol": c["symbol"],
        "signal": "BUY",
        "confidence": confidence,
        "entry_price": entry,
        "stop_loss": stop_loss,
        "target": target,
        "risk_reward_ratio": rr,
        "explanation": explanation,
        "rsi": round(c["rsi"], 1),
        "adx": round(adx, 1),
        "volume_ratio": round(c["volume_ratio"], 2),
    }


async def process_chartink_alert(
    scan_name: str, symbols: list[str], trigger_prices: list[float], triggered_at: str
) -> list[ChartinkCandidate]:
    """Entry point called by POST /chartink/webhook. Scores every symbol
    Chartink sent (genuine data failures aside), persists them, and emails
    the batch."""
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository
    from app.infra.db.repositories.chartink_scoring_config_repo import (
        SQLChartinkScoringConfigRepository,
    )
    from app.infra.db.session import AsyncSessionLocal

    trigger_by_symbol = dict(zip(symbols, trigger_prices, strict=False))

    technicals = await _fetch_technicals_async(symbols)
    if not technicals:
        log.warning(
            "chartink_signal.no_technicals", scan_name=scan_name, symbols=symbols
        )
        return []

    async with AsyncSessionLocal() as cfg_session:
        cfg = await SQLChartinkScoringConfigRepository(cfg_session).get()

    # One id shared by every candidate this call saves -- see
    # ChartinkCandidate.batch_id's docstring for why received_at can't be
    # used to group a batch instead. Used by chartink_repo's
    # compare_latest_batches() (Part 3: new/persistent/dropped vs. the
    # previous batch for this scan_name).
    batch_id = uuid4()

    candidates: list[ChartinkCandidate] = []
    for c in technicals:
        try:
            adx = _compute_adx(c["high"], c["low"], c["close"])
            macd_bullish = _macd_bullish_crossover(c["close"])
            confidence, explanation = _confidence_and_explanation(c, adx, macd_bullish, cfg)
            entry, stop_loss, target, rr = _size_entry_sl_target(c, cfg)

            candidates.append(
                ChartinkCandidate(
                    scan_name=scan_name,
                    symbol=c["symbol"],
                    trigger_price=trigger_by_symbol.get(c["symbol"], c["current"]),
                    signal="BUY",
                    confidence=confidence,
                    entry_price=entry,
                    stop_loss=stop_loss,
                    target=target,
                    risk_reward_ratio=rr,
                    holding_period="1-3 days",
                    explanation=explanation,
                    batch_id=batch_id,
                    rsi=round(c["rsi"], 1),
                    adx=round(adx, 1),
                    volume_ratio=round(c["volume_ratio"], 2),
                )
            )
        except Exception as exc:
            log.warning("chartink_signal.score_error", symbol=c.get("symbol"), error=str(exc))

    if not candidates:
        return []

    async with AsyncSessionLocal() as session:
        repo = SQLChartinkCandidateRepository(session)
        await repo.save_many(candidates)
        breakout_symbols = await repo.detect_new_breakouts(scan_name)

    log.info(
        "chartink_signal.processed",
        scan_name=scan_name,
        received=len(symbols),
        scored=len(candidates),
    )

    await _send_alert_email(scan_name, candidates, triggered_at)
    if breakout_symbols:
        await _record_and_alert_breakouts(scan_name, breakout_symbols)
    return candidates


async def _record_and_alert_breakouts(scan_name: str, symbols: list[str]) -> None:
    """Part 5 (Alerts): a symbol just crossed the 3-consecutive-batch
    streak threshold (see chartink_repo.detect_new_breakouts) -- scores
    each one with the same AI engine regular Chartink candidates use
    (confidence/entry/stop_loss/target/rsi/adx/volume_ratio), persists
    one ChartinkBreakoutAlert per symbol, and sends a dedicated breakout
    email, separate from the regular per-batch alert every candidate
    already gets via _send_alert_email. A symbol whose scorer call fails
    (e.g. delisted) still gets recorded/emailed, just without the AI
    fields -- see get_breakout_watchlist() and resolve_breakout_alerts(),
    both of which treat those as "can't resolve yet" rather than erroring."""
    from app.infra.db.repositories.chartink_breakout_repo import (
        SQLChartinkBreakoutAlertRepository,
    )
    from app.infra.db.repositories.chartink_scoring_config_repo import (
        SQLChartinkScoringConfigRepository,
    )
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as cfg_session:
        cfg = await SQLChartinkScoringConfigRepository(cfg_session).get()

    scores: dict[str, dict] = {}
    try:
        technicals = await _fetch_technicals_async(symbols)
        market_caps = await _fetch_market_caps([c["symbol"] for c in technicals])
        for c in technicals:
            try:
                adx = _compute_adx(c["high"], c["low"], c["close"])
                macd_bullish = _macd_bullish_crossover(c["close"])
                confidence, explanation = _confidence_and_explanation(c, adx, macd_bullish, cfg)
                entry, stop_loss, target, rr = _size_entry_sl_target(c, cfg)
                scores[c["symbol"]] = {
                    "confidence": confidence,
                    "entry_price": entry,
                    "stop_loss": stop_loss,
                    "target": target,
                    "risk_reward_ratio": rr,
                    "rsi": round(c["rsi"], 1),
                    "adx": round(adx, 1),
                    "volume_ratio": round(c["volume_ratio"], 2),
                    "volume": c.get("volume"),
                    "market_cap": market_caps.get(c["symbol"]),
                    "explanation": explanation,
                }
            except Exception as exc:
                log.warning(
                    "chartink_signal.breakout_score_error", symbol=c.get("symbol"), error=str(exc)
                )
    except Exception as exc:
        log.warning("chartink_signal.breakout_score_error", scan_name=scan_name, error=str(exc))

    appeared_date = datetime.now(IST).strftime("%Y-%m-%d")
    async with AsyncSessionLocal() as session:
        repo = SQLChartinkBreakoutAlertRepository(session)
        for symbol in symbols:
            s = scores.get(symbol, {})
            await repo.create(
                ChartinkBreakoutAlert(
                    scan_name=scan_name,
                    symbol=symbol,
                    appeared_date=appeared_date,
                    streak_count=3,
                    confidence=s.get("confidence"),
                    entry_price=s.get("entry_price"),
                    stop_loss=s.get("stop_loss"),
                    target=s.get("target"),
                    risk_reward_ratio=s.get("risk_reward_ratio"),
                    rsi=s.get("rsi"),
                    adx=s.get("adx"),
                    volume_ratio=s.get("volume_ratio"),
                    volume=s.get("volume"),
                    market_cap=s.get("market_cap"),
                    explanation=s.get("explanation"),
                )
            )

    log.info("chartink_signal.breakout_detected", scan_name=scan_name, symbols=symbols)
    await _send_breakout_email(scan_name, symbols)


# Breakout alerts without a resolved outcome after this many days are
# closed EXPIRED at current price -- same convention/window as MCX's
# MCX_SIGNAL_EXPIRY_DAYS (mcx_signal_service.py).
BREAKOUT_EXPIRY_DAYS = 5


async def resolve_breakout_alerts() -> int:
    """Checks every OPEN breakout alert (that has a real entry/SL/target
    from the scorer) against its live LTP -- closes it WIN if target is
    hit, LOSS if stop_loss is hit, or EXPIRED if BREAKOUT_EXPIRY_DAYS has
    passed with neither. Cash-equity long-only, same as the rest of
    Chartink, so only the BUY direction applies (unlike MCX's
    resolve_open_signals, which also handles SELL). Returns how many
    closed."""
    import yfinance as yf

    from app.infra.db.repositories.chartink_breakout_repo import (
        SQLChartinkBreakoutAlertRepository,
    )
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        repo = SQLChartinkBreakoutAlertRepository(session)
        open_alerts = await repo.list_open()
        resolvable = [a for a in open_alerts if a.entry_price and a.stop_loss and a.target]
        if not resolvable:
            return 0

        symbols = sorted({a.symbol for a in resolvable})
        try:
            loop = asyncio.get_event_loop()
            raw = await loop.run_in_executor(
                None, partial(yf.download, symbols, period="5d", auto_adjust=True, progress=False)
            )
        except Exception as exc:
            log.warning("chartink_signal.breakout_resolve.download_error", error=str(exc))
            return 0

        import pandas as pd

        is_multi = isinstance(raw.columns, pd.MultiIndex)

        def _ltp(sym: str) -> float | None:
            if raw is None or raw.empty:
                return None
            try:
                series = raw[("Close", sym)] if is_multi else raw["Close"]
                series = series.dropna()
                return float(series.iloc[-1]) if len(series) else None
            except KeyError:
                return None

        now = datetime.utcnow()
        closed = 0
        for alert in resolvable:
            ltp = _ltp(alert.symbol)
            if ltp is None:
                continue

            status: str | None = None
            exit_price: float | None = None
            if ltp >= alert.target:
                status, exit_price = "WIN", alert.target
            elif ltp <= alert.stop_loss:
                status, exit_price = "LOSS", alert.stop_loss

            age_days = (now - alert.created_at).total_seconds() / 86400
            if status is None and age_days >= BREAKOUT_EXPIRY_DAYS:
                status, exit_price = "EXPIRED", ltp

            if status is not None and exit_price is not None:
                await repo.close(alert.id, status, exit_price, now)
                closed += 1

        return closed


async def _get_recipients() -> list[str]:
    from app.core.config import settings
    from app.infra.db.repositories.email_list_repo import EmailListRepository

    email_repo = EmailListRepository()
    managed = await email_repo.list_active_emails()
    fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
    return managed if managed else ([fallback] if fallback else [])


async def _send_alert_email(
    scan_name: str, candidates: list[ChartinkCandidate], triggered_at: str
) -> None:
    from app.infra.email.chartink_report import chartink_alert_html
    from app.infra.email.client import send_email

    recipients = await _get_recipients()
    if not recipients:
        log.warning("chartink_signal.email.no_recipients")
        return

    html = chartink_alert_html(scan_name, candidates, triggered_at)
    today = datetime.now(IST).strftime("%Y-%m-%d")
    subject = f"\U0001f4c8 Chartink: {scan_name} · {len(candidates)} candidate(s) · {today}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("chartink_signal.email.failed", to=to, error=str(exc))


async def _send_breakout_email(scan_name: str, symbols: list[str]) -> None:
    from app.infra.email.chartink_report import chartink_breakout_html
    from app.infra.email.client import send_email

    recipients = await _get_recipients()
    if not recipients:
        log.warning("chartink_signal.breakout_email.no_recipients")
        return

    html = chartink_breakout_html(scan_name, symbols)
    today = datetime.now(IST).strftime("%Y-%m-%d")
    subject = f"\U0001f6a8 Breakout: {scan_name} · {len(symbols)} stock(s) 3x in a row · {today}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("chartink_signal.breakout_email.failed", to=to, error=str(exc))


# Trading-day offsets for "a week ago"/"a month ago", same convention
# portfolio_ohlc_service.py uses for the identical weekly/monthly change
# figures on portfolio holdings.
_WEEK_MONTH_LOOKBACK = {"week": 5, "month": 21}


async def get_breakout_watchlist(limit: int = 100) -> list[dict]:
    """The "separate list" of breakout-flagged stocks -- each
    ChartinkBreakoutAlert enriched with a live LTP/change/%change/weekly/
    monthly P&L, computed fresh on every read the same way
    portfolio_ohlc_service.compute_portfolio_ohlc() does for holdings,
    rather than freezing prices at alert time and letting them go stale."""
    import pandas as pd
    import yfinance as yf

    from app.infra.db.repositories.chartink_breakout_repo import (
        SQLChartinkBreakoutAlertRepository,
    )
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        alerts = await SQLChartinkBreakoutAlertRepository(session).list_recent(limit)
    if not alerts:
        return []

    symbols = sorted({a.symbol for a in alerts})
    try:
        raw = yf.download(symbols, period="2mo", auto_adjust=True, progress=False)
    except Exception as exc:
        log.warning("chartink_signal.breakout_watchlist.download_error", error=str(exc))
        raw = None

    is_multi = raw is not None and isinstance(raw.columns, pd.MultiIndex)

    def _field(field: str, sym: str) -> pd.Series | None:
        if raw is None or raw.empty:
            return None
        if is_multi:
            if (field, sym) not in raw.columns:
                return None
            return raw[(field, sym)].dropna()
        if field not in raw.columns:
            return None
        return raw[field].dropna()

    def _at(series: pd.Series | None, offset: int) -> float | None:
        if series is None or len(series) == 0:
            return None
        j = -1 - offset
        if -j > len(series):
            return None
        return float(series.iloc[j])

    rows = []
    for alert in alerts:
        close = _field("Close", alert.symbol)
        c_now = _at(close, 0)
        c_prev = _at(close, 1)
        change = round(c_now - c_prev, 2) if c_now is not None and c_prev else None
        change_pct = round(change / c_prev * 100, 2) if change is not None and c_prev else None

        week_ago = _at(close, _WEEK_MONTH_LOOKBACK["week"])
        month_ago = _at(close, _WEEK_MONTH_LOOKBACK["month"])
        weekly_pnl_pct = (
            round((c_now - week_ago) / week_ago * 100, 2)
            if c_now is not None and week_ago
            else None
        )
        monthly_pnl_pct = (
            round((c_now - month_ago) / month_ago * 100, 2)
            if c_now is not None and month_ago
            else None
        )

        rows.append(
            {
                "id": str(alert.id),
                "scan_name": alert.scan_name,
                "symbol": alert.symbol,
                "appeared_date": alert.appeared_date,
                "streak_count": alert.streak_count,
                "ltp": round(c_now, 2) if c_now is not None else None,
                "change": change,
                "change_pct": change_pct,
                "day_pnl_pct": change_pct,
                "week_pnl_pct": weekly_pnl_pct,
                "month_pnl_pct": monthly_pnl_pct,
                "created_at": alert.created_at.isoformat(),
                # AI analysis at breakout time (see _record_and_alert_breakouts) --
                # None if the scorer failed for this symbol.
                "confidence": alert.confidence,
                "entry_price": alert.entry_price,
                "stop_loss": alert.stop_loss,
                "target": alert.target,
                "risk_reward_ratio": alert.risk_reward_ratio,
                "rsi": alert.rsi,
                "adx": alert.adx,
                "volume_ratio": alert.volume_ratio,
                "volume": alert.volume,
                "market_cap": alert.market_cap,
                "explanation": alert.explanation,
                # Resolution against entry_price/stop_loss/target -- see
                # resolve_breakout_alerts().
                "status": alert.status,
                "exit_price": alert.exit_price,
                "closed_at": alert.closed_at.isoformat() if alert.closed_at else None,
            }
        )
    return rows

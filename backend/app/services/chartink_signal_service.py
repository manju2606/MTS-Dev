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

import structlog

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

    log.info(
        "chartink_signal.processed",
        scan_name=scan_name,
        received=len(symbols),
        scored=len(candidates),
    )

    await _send_alert_email(scan_name, candidates, triggered_at)
    return candidates


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

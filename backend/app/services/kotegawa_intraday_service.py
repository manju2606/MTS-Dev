"""Kotegawa Intraday service.

Same capitulation/kairi/volume/reversal rule set and same-day resolution
mechanics as Kotegawa Early Reversal (see that module's own docstring for
the full reasoning) -- the only real difference is the scan itself: a
curated ~100-stock universe (NIFTY_100, already defined in
app/infra/scanner/universe.py -- liquid, index-selected large caps) instead
of the full NIFTY 500, and a stricter min_score (65 vs Reversal/Early's 55)
to earn the "best of a minimal universe" framing on a smaller, higher-
quality candidate pool.

Orchestrates the same 3-job cycle as Early Reversal: scan every 15 min
09:30-14:45 IST, check open picks against live LTP every 5 min, force-close
anything still open at 15:35 IST.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.infra.db.repositories.kotegawa_intraday_repo import KotegawaIntradayRepository
from app.infra.scanner.kotegawa_scanner import KotegawaScan, run_kotegawa_scan
from app.infra.scanner.universe import NIFTY_100

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))

MIN_SCORE = 65
NEUTRAL_BAND_PCT = 0.2


async def run_and_save_kotegawa_intraday() -> KotegawaScan:
    """Runs one scan pass against NIFTY_100 at the stricter MIN_SCORE gate,
    filters out symbols that already have an unresolved pick today, and
    appends whatever's left. Mirrors
    kotegawa_early_service.run_and_save_kotegawa_early exactly except for
    the scan call's arguments."""
    scan = await run_kotegawa_scan(symbols=list(NIFTY_100), min_score=MIN_SCORE)
    if not scan.picks:
        return scan

    repo = KotegawaIntradayRepository()
    existing = await repo.get_scan_by_date(scan.scan_date)
    already_open = {
        p.get("symbol") for p in (existing.get("picks", []) if existing else []) if p.get("symbol")
    }

    fresh = [p for p in scan.picks if p.symbol not in already_open]
    for i, pick in enumerate(fresh):
        pick.rank = i + 1

    await repo.append_picks(
        scan_date=scan.scan_date,
        scan_time=scan.scan_time,
        universe_scanned=scan.universe_scanned,
        passed_filter=scan.passed_filter,
        new_picks=fresh,
    )
    log.info(
        "kotegawa_intraday.saved",
        date=scan.scan_date,
        found=len(scan.picks),
        appended=len(fresh),
        already_open=len(already_open),
    )
    return scan


async def check_kotegawa_intraday_outcomes() -> int:
    """Every 5 min during market hours: checks every still-open pick from
    today against live LTP vs its own target_1/stop_loss -> WIN/LOSS.
    Mirrors kotegawa_early_service.check_kotegawa_early_outcomes exactly."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = KotegawaIntradayRepository()
    today = datetime.now(IST).strftime("%Y-%m-%d")
    scans = await repo.list_scans_with_unresolved_picks(today)
    if not scans:
        return 0

    client = YFinanceClient()
    resolved = 0

    async def _check_pick(scan_id: str, pick: dict) -> None:
        nonlocal resolved
        if pick.get("outcome") is not None:
            return
        symbol = pick.get("symbol")
        entry = pick.get("entry_price")
        stop_loss = pick.get("stop_loss")
        target_1 = pick.get("target_1")
        if not symbol or entry is None or stop_loss is None or target_1 is None:
            return
        try:
            quote = await client.get_quote(symbol)
        except Exception as exc:
            log.debug("kotegawa_intraday.check.quote_error", symbol=symbol, error=str(exc))
            return

        price = quote.price
        target_hit = price >= target_1
        stop_hit = price <= stop_loss
        if not (target_hit or stop_hit):
            return

        outcome = "WIN" if target_hit else "LOSS"
        actual_pct = round((price - entry) / entry * 100, 2) if entry > 0 else 0.0
        await repo.update_pick_outcome(scan_id, symbol, price, actual_pct, outcome)
        resolved += 1
        log.info("kotegawa_intraday.check.resolved", symbol=symbol, outcome=outcome, price=price)

    tasks = [
        _check_pick(scan.get("id", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    return resolved


async def expire_kotegawa_intraday_picks() -> int:
    """Called at 15:35 IST: force-closes any still-open pick from today at
    the current market price -- +-0.2% band for NEUTRAL. Mirrors
    kotegawa_early_service.expire_kotegawa_early_picks exactly."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = KotegawaIntradayRepository()
    today = datetime.now(IST).strftime("%Y-%m-%d")
    scans = await repo.list_scans_with_unresolved_picks(today)
    if not scans:
        return 0

    client = YFinanceClient()
    closed = 0

    async def _close_pick(scan_id: str, pick: dict) -> None:
        nonlocal closed
        if pick.get("outcome") is not None:
            return
        symbol = pick.get("symbol")
        entry = pick.get("entry_price")
        if not symbol or entry is None:
            return
        try:
            quote = await client.get_quote(symbol)
            price = quote.price
        except Exception as exc:
            log.debug("kotegawa_intraday.expire.quote_error", symbol=symbol, error=str(exc))
            price = entry

        actual_pct = round((price - entry) / entry * 100, 2) if entry > 0 else 0.0
        outcome = (
            "WIN" if actual_pct > NEUTRAL_BAND_PCT
            else "LOSS" if actual_pct < -NEUTRAL_BAND_PCT
            else "NEUTRAL"
        )
        await repo.update_pick_outcome(scan_id, symbol, price, actual_pct, outcome)
        closed += 1
        log.info("kotegawa_intraday.expire.closed", symbol=symbol, outcome=outcome, price=price)

    tasks = [
        _close_pick(scan.get("id", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    return closed

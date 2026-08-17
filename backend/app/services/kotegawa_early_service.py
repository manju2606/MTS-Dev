"""Kotegawa Early Reversal service.

Same capitulation/kairi/volume/reversal rule set as Kotegawa Reversal (see
kotegawa_scanner.run_kotegawa_scan), but scanned repeatedly through the
trading session (09:30-14:45 IST, every 15 min -- same cadence as Golden
Stock Intraday) instead of once at the close, so a candidate can be caught
and entered intraday, same-day, instead of only via a next-day BTST entry.

Resolution is same-day, Golden-Egg-style (see golden_egg_service.py's
check_golden_egg_outcomes/expire_golden_egg_picks): live LTP polled every 5
min against each open pick's own target_1/stop_loss -> WIN/LOSS, and
anything still open at 15:35 IST is force-closed at the current price
(+-0.2% band -> NEUTRAL) -- not Reversal's 5-day BTST-style window.

Orchestrates:
  1. Run the scan every 15 min, 09:30-14:45 IST (scheduler job
     kotegawa_early_scan) -- excludes symbols that already have an
     unresolved pick today, appends genuinely new ones (see
     KotegawaEarlyRepository.append_picks's own docstring for why this
     accumulates instead of overwriting)
  2. Check open picks against live LTP every 5 min during market hours
  3. Force-close anything still open at 15:35 IST

No email/watchlist side effects (unlike Reversal's once-daily scan) --
repeating those every 15 min would spam the same channels Reversal already
uses for what's meant to be a single daily digest.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.infra.db.repositories.kotegawa_early_repo import KotegawaEarlyRepository
from app.infra.scanner.kotegawa_scanner import KotegawaScan, run_kotegawa_scan

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))

# +-0.2% band for a forced EOD close to count as NEUTRAL rather than a WIN/LOSS
# by a hair -- same convention as golden_egg_service.expire_golden_egg_picks.
NEUTRAL_BAND_PCT = 0.2


async def run_and_save_kotegawa_early() -> KotegawaScan:
    """Runs one scan pass, filters out symbols that already have an
    unresolved pick today, and appends whatever's left. Returns the raw
    scan (unfiltered) for the admin-triggered manual-scan endpoint's
    response -- the caller can see what the scan found even if all of it
    was filtered as already-tracked."""
    scan = await run_kotegawa_scan()
    if not scan.picks:
        return scan

    repo = KotegawaEarlyRepository()
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
        "kotegawa_early.saved",
        date=scan.scan_date,
        found=len(scan.picks),
        appended=len(fresh),
        already_open=len(already_open),
    )
    return scan


async def check_kotegawa_early_outcomes() -> int:
    """Every 5 min during market hours: checks every still-open pick from
    today against live LTP vs its own target_1/stop_loss -> WIN/LOSS.
    Mirrors golden_egg_service.check_golden_egg_outcomes, generalized to
    more than one open pick at a time. Returns the number resolved this
    run."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = KotegawaEarlyRepository()
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
            log.debug("kotegawa_early.check.quote_error", symbol=symbol, error=str(exc))
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
        log.info("kotegawa_early.check.resolved", symbol=symbol, outcome=outcome, price=price)

    tasks = [
        _check_pick(scan.get("id", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    return resolved


async def expire_kotegawa_early_picks() -> int:
    """Called at 15:35 IST: force-closes any still-open pick from today at
    the current market price -- +-0.2% band for NEUTRAL, same convention
    as golden_egg_service.expire_golden_egg_picks. Returns the number
    closed."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = KotegawaEarlyRepository()
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
            log.debug("kotegawa_early.expire.quote_error", symbol=symbol, error=str(exc))
            price = entry

        actual_pct = round((price - entry) / entry * 100, 2) if entry > 0 else 0.0
        outcome = (
            "WIN" if actual_pct > NEUTRAL_BAND_PCT
            else "LOSS" if actual_pct < -NEUTRAL_BAND_PCT
            else "NEUTRAL"
        )
        await repo.update_pick_outcome(scan_id, symbol, price, actual_pct, outcome)
        closed += 1
        log.info("kotegawa_early.expire.closed", symbol=symbol, outcome=outcome, price=price)

    tasks = [
        _close_pick(scan.get("id", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    return closed

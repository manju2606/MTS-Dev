"""AI Strategy Lab orchestration -- ties together historical data (via
historical_data_service, auto-downloading through the connected Zerodha
session if a symbol's history isn't already stored), candidate generation,
the backtest/walk-forward/ranking engines, and persistence.

No Celery/job-queue in this v1 (see conversation) -- a run is processed by
a plain `asyncio.create_task` fired from the API layer, with each
candidate's CPU-bound backtest work offloaded to a thread via
`asyncio.to_thread` so it doesn't block the event loop for other requests.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime

import structlog

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.models.strategy_lab import (
    BacktestMetrics,
    IndexScanRun,
    StrategyCandidate,
    StrategyLabResult,
    StrategyLabRun,
    WalkForwardSplit,
)
from app.domain.services.strategy_lab.engine import run_backtest
from app.domain.services.strategy_lab.generator import generate_candidates
from app.domain.services.strategy_lab.metrics import compute_metrics, drawdown_curve
from app.domain.services.strategy_lab.opening_range_breakout import run_orb_backtest
from app.domain.services.strategy_lab.ranking import composite_score
from app.domain.services.strategy_lab.rsi_reversion_v2 import (
    RSI_REVERSION_VERSIONS,
    run_rsi_reversion_backtest,
)
from app.domain.services.strategy_lab.trend_pullback import (
    TREND_PULLBACK_VERSIONS,
    run_trend_pullback_backtest,
)
from app.domain.services.strategy_lab.walk_forward import TRAIN_FRACTION, run_walk_forward
from app.infra.db.repositories.historical_candle_repo import HistoricalCandleRepository
from app.infra.db.repositories.strategy_lab_repo import StrategyLabRepository
from app.services import historical_data_service

log = structlog.get_logger()

MIN_CANDLES_REQUIRED = 100
MAX_CANDIDATES_PER_RUN = 400
MIN_TREND_PULLBACK_5M_CANDLES = 250
MIN_TREND_PULLBACK_1H_CANDLES = 50
MIN_ORB_CANDLES = 100
MIN_RSI_REVERSION_CANDLES = 100

@dataclass(frozen=True)
class IndexUniverse:
    exchange: str  # the run's exchange must match this exactly
    symbols: list[str]


# NIFTY 50 constituents (NSE tradingsymbols) -- index composition is
# reconstituted periodically (semi-annually), so this drifts out of date
# over time; it isn't pulled from a live index-membership API since none is
# wired up. Good enough for "scan the current large-cap universe" -- not a
# guarantee of exact membership on any given day.
NIFTY_50_SYMBOLS = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BPCL",
    "BHARTIARTL", "BRITANNIA", "CIPLA", "COALINDIA", "DRREDDY",
    "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "ITC",
    "INDUSINDBK", "INFY", "JSWSTEEL", "KOTAKBANK", "LT",
    "M&M", "MARUTI", "NTPC", "NESTLEIND", "ONGC",
    "POWERGRID", "RELIANCE", "SBILIFE", "SHRIRAMFIN", "SBIN",
    "SUNPHARMA", "TCS", "TATACONSUM", "TATAMOTORS", "TATASTEEL",
    "TECHM", "TITAN", "TRENT", "ULTRACEMCO", "WIPRO",
]

# NIFTY MIDCAP 50 -- same staleness caveat as NIFTY_50_SYMBOLS above, but
# meaningfully lower confidence: this index reconstitutes more often and is
# less memorable/verifiable from training data than the large-cap 50. A
# wrong/delisted symbol here just fails cleanly for that one stock (shows up
# in the scan's failed_symbols, same as any other download error) rather
# than corrupting anything -- but treat this list as best-effort, not
# authoritative, and expect a few misses.
NIFTY_MIDCAP_50_SYMBOLS = [
    "ABCAPITAL", "ALKEM", "APLAPOLLO", "ASHOKLEY", "ASTRAL",
    "AUBANK", "BALKRISIND", "BANDHANBNK", "BHARATFORGE", "BHEL",
    "CGPOWER", "COFORGE", "COLPAL", "CONCOR", "COROMANDEL",
    "CROMPTON", "CUMMINSIND", "DALBHARAT", "DIXON", "ESCORTS",
    "EXIDEIND", "FEDERALBNK", "FORTIS", "GMRAIRPORT", "GODREJPROP",
    "HDFCAMC", "HONAUT", "IDFCFIRSTB", "IEX", "INDHOTEL",
    "INDUSTOWER", "IPCALAB", "JUBLFOOD", "LICHSGFIN", "LUPIN",
    "MANAPPURAM", "MAXHEALTH", "MFSL", "NMDC", "OBEROIRLTY",
    "OFSS", "PAGEIND", "PERSISTENT", "PIIND", "POLYCAB",
    "PRESTIGE", "SRF", "SUPREMEIND", "SUZLON", "VOLTAS",
]

# NIFTY SMALLCAP 50 -- same caveat as MIDCAP above, with even lower
# confidence: smallcap index membership shifts the most and these are the
# least "famous" names to verify from memory alone. Best-effort.
NIFTY_SMALLCAP_50_SYMBOLS = [
    "AARTIIND", "AAVAS", "ACE", "AEGISLOG", "AFFLE",
    "ALKYLAMINE", "AMBER", "ANANTRAJ", "ANGELONE", "APOLLOTYRE",
    "APTUS", "ATUL", "BALRAMCHIN", "BASF", "BATAINDIA",
    "BSOFT", "BLUEDART", "BLUESTARCO", "CAMS", "CAPLIPOINT",
    "CARBORUNIV", "CEATLTD", "CENTURYPLY", "CERA", "CHAMBLFERT",
    "CHOLAHLDNG", "CYIENT", "DEEPAKFERT", "EIDPARRY", "EIHOTEL",
    "ELGIEQUIP", "EMAMILTD", "FINEORG", "FINCABLES", "GALAXYSURF",
    "GESHIP", "GRINDWELL", "GRSE", "HAPPSTMNDS", "HEG",
    "IFBIND", "IIFL", "JBCHEPHARM", "JKCEMENT", "JKLAKSHMI",
    "JUBLINGREA", "JUSTDIAL", "KAJARIACER", "KEI", "KPRMILL",
]


def _mcx_all_symbols() -> list[str]:
    # Reuses the exact same 19 contract-family keys already defined for the
    # Historical Data page's MCX dropdown -- not re-typed, so this can never
    # drift out of sync with what the rest of the app calls these contracts.
    return list(historical_data_service.MCX_CONTRACT_LABELS)


INDEX_UNIVERSES: dict[str, IndexUniverse] = {
    "NIFTY50": IndexUniverse(exchange="NSE", symbols=NIFTY_50_SYMBOLS),
    "NIFTY_MIDCAP_50": IndexUniverse(exchange="NSE", symbols=NIFTY_MIDCAP_50_SYMBOLS),
    "NIFTY_SMALLCAP_50": IndexUniverse(exchange="NSE", symbols=NIFTY_SMALLCAP_50_SYMBOLS),
    "MCX_ALL": IndexUniverse(exchange="MCX", symbols=_mcx_all_symbols()),
}


async def _resolve_effective_symbol(user_id: str, symbol: str, exchange: str) -> str:
    """For MCX, the symbol picked in the UI is a contract-family key (e.g.
    "NG"), not a literal tradingsymbol -- resolve it the same way
    historical_data_service does, so candle storage/lookup and the run
    record agree on the actual instrument."""
    if exchange.upper() != "MCX":
        return symbol
    broker = await historical_data_service.get_zerodha_broker(user_id)
    resolved = await historical_data_service.resolve_mcx_instrument(broker, symbol)
    return str(resolved["tradingsymbol"])


async def _ensure_candles(
    user_id: str,
    symbol: str,
    effective_symbol: str,
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    candle_repo: HistoricalCandleRepository,
    min_required: int,
) -> list[HistoricalCandle]:
    """Fetches stored candles, auto-downloading first if there aren't
    enough. Never raises for "contract didn't exist that far back" --
    Kite just returns whatever it has, which may be less than requested
    (see the MCX contract-rollover conversation); only raises if that's
    still below `min_required` after trying."""
    candles = await candle_repo.get_range(effective_symbol, exchange, interval, from_dt, to_dt)
    if len(candles) < min_required:
        download_results = await historical_data_service.download_batch_official(
            user_id=user_id,
            symbols=[symbol],
            exchange=exchange,
            interval=interval,
            from_dt=from_dt,
            to_dt=to_dt,
            include_oi=False,
            repo=candle_repo,
        )
        failed = [r for r in download_results if not r["ok"]]
        if failed:
            raise RuntimeError(f"Historical data download failed: {failed[0]['error']}")
        candles = await candle_repo.get_range(effective_symbol, exchange, interval, from_dt, to_dt)

    if len(candles) < min_required:
        raise RuntimeError(
            f"Only {len(candles)} '{interval}' candles available for {effective_symbol} "
            f"({exchange}) over {from_dt.date()} to {to_dt.date()} -- need at least "
            f"{min_required}. Kite only retains data for currently-listed contracts, so "
            f"for MCX this is usually capped by when the current contract started trading, "
            f"not by your requested start date."
        )
    return candles


async def start_run(
    user_id: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> str:
    repo = StrategyLabRepository()
    await repo.ensure_indexes()

    run = StrategyLabRun(
        id=StrategyLabRun.new_id(),
        user_id=user_id,
        symbol=symbol,
        exchange=exchange.upper(),
        interval=interval,
        from_date=from_date,
        to_date=to_date,
        capital=capital,
        status="pending",
    )
    await repo.create_run(run)
    asyncio.create_task(
        _process_run(run.id, user_id, symbol, exchange, interval, from_date, to_date, capital)
    )
    return run.id


async def _process_run(
    run_id: str,
    user_id: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> None:
    repo = StrategyLabRepository()
    candle_repo = HistoricalCandleRepository()

    try:
        await repo.update_run(run_id, status="downloading")

        effective_symbol = await _resolve_effective_symbol(user_id, symbol, exchange)
        if effective_symbol != symbol:
            await repo.update_run(run_id, symbol=effective_symbol)

        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)

        candles = await _ensure_candles(
            user_id, symbol, effective_symbol, exchange, interval, from_dt, to_dt,
            candle_repo, MIN_CANDLES_REQUIRED,
        )

        await repo.update_run(run_id, status="generating")
        candidates = generate_candidates(MAX_CANDIDATES_PER_RUN)
        await repo.update_run(run_id, status="running", total_candidates=len(candidates))

        best: StrategyLabResult | None = None
        for completed, candidate in enumerate(candidates, start=1):
            result = await _backtest_one(run_id, candles, candidate, capital)
            await repo.save_result(result)
            if best is None or result.composite_score > best.composite_score:
                best = result
            if completed % 5 == 0 or completed == len(candidates):
                await repo.update_run(run_id, completed_candidates=completed)

        await repo.update_run(
            run_id, status="completed", completed_at=datetime.utcnow(),
            best_candidate_name=best.candidate.name if best else None,
            best_composite_score=best.composite_score if best else None,
        )

    except Exception as exc:
        log.error("strategy_lab.run_failed", run_id=run_id, error=str(exc))
        await repo.update_run(run_id, status="failed", error=str(exc))


async def _backtest_one(
    run_id: str, candles: list[HistoricalCandle], candidate: StrategyCandidate, capital: float
) -> StrategyLabResult:
    def work() -> StrategyLabResult:
        outcome = run_backtest(candles, candidate, capital)
        full_metrics = compute_metrics(outcome, capital)
        walk_forward = run_walk_forward(candles, candidate, capital)
        score = composite_score(full_metrics, walk_forward)
        return StrategyLabResult(
            id=StrategyLabResult.new_id(),
            run_id=run_id,
            candidate=candidate,
            full_metrics=full_metrics,
            walk_forward=walk_forward,
            composite_score=score,
            equity_curve=outcome.equity_curve,
            drawdown_curve=drawdown_curve(outcome.equity_curve),
            trades=outcome.trades,
        )

    return await asyncio.to_thread(work)


# ── Index Scan (full generated sweep across every symbol in an index) ──────


async def start_index_scan_run(
    user_id: str,
    index: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> str:
    # No caller-supplied exchange -- each index universe has exactly one
    # correct exchange (NIFTY* are NSE, MCX_ALL is MCX), so deriving it here
    # removes the whole "picked the wrong exchange for this index" bug class
    # instead of just validating against it (see conversation: BSE/NFO/MCX
    # silently returning nothing for a run meant to scan NSE symbols).
    if index not in INDEX_UNIVERSES:
        raise ValueError(f"Unknown index '{index}' -- expected one of {list(INDEX_UNIVERSES)}")

    universe = INDEX_UNIVERSES[index]
    repo = StrategyLabRepository()
    await repo.ensure_indexes()

    scan = IndexScanRun(
        id=IndexScanRun.new_id(),
        user_id=user_id,
        index=index,
        exchange=universe.exchange,
        interval=interval,
        from_date=from_date,
        to_date=to_date,
        capital=capital,
        status="pending",
        total_symbols=len(universe.symbols),
    )
    await repo.create_index_scan(scan)
    asyncio.create_task(
        _process_index_scan(scan.id, user_id, index, interval, from_date, to_date, capital)
    )
    return scan.id


async def _process_index_scan(
    scan_id: str,
    user_id: str,
    index: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> None:
    """Runs the existing single-symbol generate+backtest pipeline
    (start_run/_process_run, unchanged) once per symbol in the index,
    sequentially -- not concurrently, so a run of ~50 symbols x 392
    candidates each doesn't hammer the Zerodha historical-data API or spike
    CPU across every candidate of every symbol at once. Each symbol's full
    result set stays exactly where the single-stock flow already puts it
    (its own StrategyLabRun); get_index_scan_ranking() reads the best result
    back out of each afterward rather than duplicating any data here."""
    repo = StrategyLabRepository()
    universe = INDEX_UNIVERSES[index]
    exchange = universe.exchange
    symbols = universe.symbols

    try:
        await repo.update_index_scan(scan_id, status="running")
        child_run_ids: dict[str, str] = {}
        failed_symbols: list[str] = []

        for completed, symbol in enumerate(symbols, start=1):
            try:
                child_run_id = await start_run(
                    user_id=user_id, symbol=symbol, exchange=exchange,
                    interval=interval, from_date=from_date, to_date=to_date, capital=capital,
                )
                child_run_ids[symbol] = child_run_id

                # Poll the child run to completion before starting the next
                # symbol -- _process_run is its own asyncio.create_task, so
                # without waiting here every symbol would kick off at once.
                while True:
                    child = await repo.get_run(child_run_id)
                    if child is None or child.status in ("completed", "failed"):
                        break
                    await asyncio.sleep(2)

                if child is None or child.status == "failed":
                    failed_symbols.append(symbol)
                    log.warning(
                        "strategy_lab.index_scan.symbol_failed",
                        scan_id=scan_id, symbol=symbol,
                        error=child.error if child else "run not found",
                    )
            except Exception as exc:
                failed_symbols.append(symbol)
                log.warning("strategy_lab.index_scan.symbol_error", scan_id=scan_id, symbol=symbol, error=str(exc))

            await repo.update_index_scan(
                scan_id, completed_symbols=completed, child_run_ids=child_run_ids, failed_symbols=failed_symbols,
            )

        await repo.update_index_scan(scan_id, status="completed", completed_at=datetime.utcnow())

    except Exception as exc:
        log.error("strategy_lab.index_scan.failed", scan_id=scan_id, error=str(exc))
        await repo.update_index_scan(scan_id, status="failed", error=str(exc))


async def get_index_scan_ranking(scan_id: str) -> list[dict]:
    """Best (top composite_score) result per symbol scanned so far, ranked
    across the whole index -- "best stocks" for this strategy family/date
    range. Symbols whose child run hasn't completed yet (or produced zero
    results, e.g. all candidates had too few trades) are simply omitted, so
    this is safe to call while a scan is still in progress for a live-
    updating leaderboard."""
    repo = StrategyLabRepository()
    scan = await repo.get_index_scan(scan_id)
    if scan is None:
        return []

    ranking: list[dict] = []
    for symbol, child_run_id in scan.child_run_ids.items():
        results = await repo.list_results(child_run_id, limit=1)
        if results:
            best = results[0]
            ranking.append({"symbol": symbol, "run_id": child_run_id, **best})
    ranking.sort(key=lambda r: r["composite_score"], reverse=True)
    return ranking


# ── Trend Pullback (hand-designed multi-timeframe strategy) ────────────────


async def start_trend_pullback_run(
    user_id: str,
    symbol: str,
    exchange: str,
    from_date: str,
    to_date: str,
    capital: float,
    version: str = "v1.0",
) -> str:
    if version not in TREND_PULLBACK_VERSIONS:
        raise ValueError(f"Unknown Trend Pullback version '{version}' -- expected one of "
                          f"{list(TREND_PULLBACK_VERSIONS)}")

    repo = StrategyLabRepository()
    await repo.ensure_indexes()

    run = StrategyLabRun(
        id=StrategyLabRun.new_id(),
        user_id=user_id,
        symbol=symbol,
        exchange=exchange.upper(),
        interval=f"5minute (1H 200EMA filter, {version})",
        from_date=from_date,
        to_date=to_date,
        capital=capital,
        status="pending",
    )
    await repo.create_run(run)
    asyncio.create_task(
        _process_trend_pullback_run(
            run.id, user_id, symbol, exchange, from_date, to_date, capital, version
        )
    )
    return run.id


async def _process_trend_pullback_run(
    run_id: str,
    user_id: str,
    symbol: str,
    exchange: str,
    from_date: str,
    to_date: str,
    capital: float,
    version: str,
) -> None:
    repo = StrategyLabRepository()
    candle_repo = HistoricalCandleRepository()

    try:
        await repo.update_run(run_id, status="downloading")

        effective_symbol = await _resolve_effective_symbol(user_id, symbol, exchange)
        if effective_symbol != symbol:
            await repo.update_run(run_id, symbol=effective_symbol)

        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)

        candles_5m = await _ensure_candles(
            user_id, symbol, effective_symbol, exchange, "5minute", from_dt, to_dt,
            candle_repo, MIN_TREND_PULLBACK_5M_CANDLES,
        )
        candles_1h = await _ensure_candles(
            user_id, symbol, effective_symbol, exchange, "60minute", from_dt, to_dt,
            candle_repo, MIN_TREND_PULLBACK_1H_CANDLES,
        )

        await repo.update_run(run_id, status="running", total_candidates=1)

        result = await _backtest_trend_pullback(run_id, candles_5m, candles_1h, capital, version)
        await repo.save_result(result)
        await repo.update_run(
            run_id, status="completed", completed_candidates=1, completed_at=datetime.utcnow(),
            best_candidate_name=result.candidate.name, best_composite_score=result.composite_score,
        )

    except Exception as exc:
        log.error("strategy_lab.trend_pullback_failed", run_id=run_id, error=str(exc))
        await repo.update_run(run_id, status="failed", error=str(exc))


async def _backtest_trend_pullback(
    run_id: str,
    candles_5m: list[HistoricalCandle],
    candles_1h: list[HistoricalCandle],
    capital: float,
    version: str,
) -> StrategyLabResult:
    def work() -> StrategyLabResult:
        params = TREND_PULLBACK_VERSIONS[version]
        outcome = run_trend_pullback_backtest(candles_5m, candles_1h, capital, params)
        full_metrics = compute_metrics(outcome, capital)

        split_idx = int(len(candles_5m) * TRAIN_FRACTION)
        split_time = candles_5m[split_idx].time
        train_5m, test_5m = candles_5m[:split_idx], candles_5m[split_idx:]
        train_1h = [c for c in candles_1h if c.time < split_time]
        test_1h = [c for c in candles_1h if c.time >= split_time]

        train_metrics = compute_metrics(
            run_trend_pullback_backtest(train_5m, train_1h, capital, params), capital
        )
        test_metrics = compute_metrics(
            run_trend_pullback_backtest(test_5m, test_1h, capital, params), capital
        )
        walk_forward = WalkForwardSplit(
            train_metrics=train_metrics,
            test_metrics=test_metrics,
            stability_score=_custom_strategy_stability(train_metrics, test_metrics),
        )
        score = composite_score(full_metrics, walk_forward)

        description = (
            f"5-min execution, 1H 200 EMA trend filter. Buy: price above 1H 200EMA, "
            f"EMA20>EMA50 (5m), ADX>{params.adx_threshold:g}, price pulls back to EMA20 "
            f"(within {params.pullback_tolerance * 100:g}%), bullish close, volume above "
            f"average. Stop: entry - {params.atr_stop_mult:g}xATR. Target: entry + "
            f"{params.atr_target_mult:g}xATR, exits early on a SuperTrend(10,3) flip. "
            f"Risk-based sizing (2% of capital per trade)."
        )
        if version == "v2.0":
            description += (
                " v2.0: tightened ADX/stop/pullback vs v1.0 based on a real parameter "
                "sweep -- a validated drawdown/profit-factor improvement, NOT a validated "
                "profitable edge (insufficient MCX history to confirm that yet)."
            )

        candidate = StrategyCandidate(
            id=StrategyCandidate.new_id(),
            name=f"Trend Pullback (1H 200EMA Filter) {version}",
            family="trend_pullback",
            description=description,
            params={
                "adx_threshold": params.adx_threshold,
                "atr_stop_mult": params.atr_stop_mult,
                "atr_target_mult": params.atr_target_mult,
                "pullback_tolerance_pct": params.pullback_tolerance * 100,
            },
            stop_loss_pct=0.0,
            target_pct=0.0,
            trailing_stop_pct=None,
            position_size_pct=2.0,
        )
        return StrategyLabResult(
            id=StrategyLabResult.new_id(),
            run_id=run_id,
            candidate=candidate,
            full_metrics=full_metrics,
            walk_forward=walk_forward,
            composite_score=score,
            equity_curve=outcome.equity_curve,
            drawdown_curve=drawdown_curve(outcome.equity_curve),
            trades=outcome.trades,
        )

    return await asyncio.to_thread(work)


# ── Opening Range Breakout (hand-designed day-session strategy) ────────────


async def start_orb_run(
    user_id: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> str:
    repo = StrategyLabRepository()
    await repo.ensure_indexes()

    run = StrategyLabRun(
        id=StrategyLabRun.new_id(),
        user_id=user_id,
        symbol=symbol,
        exchange=exchange.upper(),
        interval=f"{interval} (09:00-09:30 opening range)",
        from_date=from_date,
        to_date=to_date,
        capital=capital,
        status="pending",
    )
    await repo.create_run(run)
    asyncio.create_task(
        _process_orb_run(run.id, user_id, symbol, exchange, interval, from_date, to_date, capital)
    )
    return run.id


async def _process_orb_run(
    run_id: str,
    user_id: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_date: str,
    to_date: str,
    capital: float,
) -> None:
    repo = StrategyLabRepository()
    candle_repo = HistoricalCandleRepository()

    try:
        await repo.update_run(run_id, status="downloading")

        effective_symbol = await _resolve_effective_symbol(user_id, symbol, exchange)
        if effective_symbol != symbol:
            await repo.update_run(run_id, symbol=effective_symbol)

        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)

        candles = await _ensure_candles(
            user_id, symbol, effective_symbol, exchange, interval, from_dt, to_dt,
            candle_repo, MIN_ORB_CANDLES,
        )

        await repo.update_run(run_id, status="running", total_candidates=1)

        result = await _backtest_orb(run_id, candles, capital, interval)
        await repo.save_result(result)
        await repo.update_run(
            run_id, status="completed", completed_candidates=1, completed_at=datetime.utcnow(),
            best_candidate_name=result.candidate.name, best_composite_score=result.composite_score,
        )

    except Exception as exc:
        log.error("strategy_lab.orb_failed", run_id=run_id, error=str(exc))
        await repo.update_run(run_id, status="failed", error=str(exc))


async def _backtest_orb(
    run_id: str, candles: list[HistoricalCandle], capital: float, interval: str
) -> StrategyLabResult:
    def work() -> StrategyLabResult:
        outcome = run_orb_backtest(candles, capital)
        full_metrics = compute_metrics(outcome, capital)

        split_idx = int(len(candles) * TRAIN_FRACTION)
        train_candles, test_candles = candles[:split_idx], candles[split_idx:]
        train_metrics = compute_metrics(run_orb_backtest(train_candles, capital), capital)
        test_metrics = compute_metrics(run_orb_backtest(test_candles, capital), capital)
        walk_forward = WalkForwardSplit(
            train_metrics=train_metrics,
            test_metrics=test_metrics,
            stability_score=_custom_strategy_stability(train_metrics, test_metrics),
        )
        score = composite_score(full_metrics, walk_forward)

        candidate = StrategyCandidate(
            id=StrategyCandidate.new_id(),
            name="Opening Range Breakout (09:00-09:30)",
            family="opening_range_breakout",
            description=(
                f"{interval} bars. Opening range = high/low of 09:00-09:30. Buy the "
                f"first breakout above the range high after 09:30 with volume above "
                f"its 20-bar average -- at most one trade per day. Stop: the opening "
                f"range's low. Target: entry + 2xATR(14). Any position still open at "
                f"the day's last bar is squared off there (ORB is intraday). "
                f"Risk-based sizing (2% of capital per trade)."
            ),
            params={"range_start_min": 540, "range_end_min": 570, "atr_target_mult": 2.0},
            stop_loss_pct=0.0,
            target_pct=0.0,
            trailing_stop_pct=None,
            position_size_pct=2.0,
        )
        return StrategyLabResult(
            id=StrategyLabResult.new_id(),
            run_id=run_id,
            candidate=candidate,
            full_metrics=full_metrics,
            walk_forward=walk_forward,
            composite_score=score,
            equity_curve=outcome.equity_curve,
            drawdown_curve=drawdown_curve(outcome.equity_curve),
            trades=outcome.trades,
        )

    return await asyncio.to_thread(work)


# ── RSI-14 Reversion (hand-designed, v1.0 long-only / v2.0 long+short) ─────


async def start_rsi_reversion_run(
    user_id: str,
    symbol: str,
    exchange: str,
    from_date: str,
    to_date: str,
    capital: float,
    version: str = "v1.0",
) -> str:
    if version not in RSI_REVERSION_VERSIONS:
        raise ValueError(f"Unknown RSI Reversion version '{version}' -- expected one of "
                          f"{list(RSI_REVERSION_VERSIONS)}")

    repo = StrategyLabRepository()
    await repo.ensure_indexes()

    run = StrategyLabRun(
        id=StrategyLabRun.new_id(),
        user_id=user_id,
        symbol=symbol,
        exchange=exchange.upper(),
        interval=f"5minute (RSI-14 Reversion, {version})",
        from_date=from_date,
        to_date=to_date,
        capital=capital,
        status="pending",
    )
    await repo.create_run(run)
    asyncio.create_task(
        _process_rsi_reversion_run(run.id, user_id, symbol, exchange, from_date, to_date, capital, version)
    )
    return run.id


async def _process_rsi_reversion_run(
    run_id: str,
    user_id: str,
    symbol: str,
    exchange: str,
    from_date: str,
    to_date: str,
    capital: float,
    version: str,
) -> None:
    repo = StrategyLabRepository()
    candle_repo = HistoricalCandleRepository()

    try:
        await repo.update_run(run_id, status="downloading")

        effective_symbol = await _resolve_effective_symbol(user_id, symbol, exchange)
        if effective_symbol != symbol:
            await repo.update_run(run_id, symbol=effective_symbol)

        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)

        candles = await _ensure_candles(
            user_id, symbol, effective_symbol, exchange, "5minute", from_dt, to_dt,
            candle_repo, MIN_RSI_REVERSION_CANDLES,
        )

        await repo.update_run(run_id, status="running", total_candidates=1)

        result = await _backtest_rsi_reversion(run_id, candles, capital, version)
        await repo.save_result(result)
        await repo.update_run(
            run_id, status="completed", completed_candidates=1, completed_at=datetime.utcnow(),
            best_candidate_name=result.candidate.name, best_composite_score=result.composite_score,
        )

    except Exception as exc:
        log.error("strategy_lab.rsi_reversion_failed", run_id=run_id, error=str(exc))
        await repo.update_run(run_id, status="failed", error=str(exc))


async def _backtest_rsi_reversion(
    run_id: str, candles: list[HistoricalCandle], capital: float, version: str
) -> StrategyLabResult:
    def work() -> StrategyLabResult:
        params = RSI_REVERSION_VERSIONS[version]
        outcome = run_rsi_reversion_backtest(candles, capital, params)
        full_metrics = compute_metrics(outcome, capital)

        split_idx = int(len(candles) * TRAIN_FRACTION)
        train_candles, test_candles = candles[:split_idx], candles[split_idx:]
        train_metrics = compute_metrics(
            run_rsi_reversion_backtest(train_candles, capital, params), capital
        )
        test_metrics = compute_metrics(
            run_rsi_reversion_backtest(test_candles, capital, params), capital
        )
        walk_forward = WalkForwardSplit(
            train_metrics=train_metrics,
            test_metrics=test_metrics,
            stability_score=_custom_strategy_stability(train_metrics, test_metrics),
        )
        score = composite_score(full_metrics, walk_forward)

        description = (
            f"5-min candles. Buy when RSI-{params.period} drops below {params.oversold:g} "
            f"(oversold), while flat. Stop: entry - {params.stop_loss_pct:g}%, trailing up to "
            f"close x (1 - {params.trailing_stop_pct:g}%) once favorable. Target: entry + "
            f"{params.target_pct:g}%. Exits early if RSI climbs back above "
            f"{params.overbought:g}. Risk-based sizing (2% of capital per trade)."
        )
        if params.allow_short:
            description += (
                f" Adds a short leg, symmetric mirror of the long side: short when "
                f"RSI rises above {params.overbought:g} while flat, cover on the mirrored "
                f"stop/trailing-stop/target, or early if RSI drops back below "
                f"{params.oversold:g}. v1.0 (long-only) is the exact logic already deployed "
                f"live for Natural Gas Mini -- this run is what validates (or rejects) "
                f"whether adding shorts is a genuine improvement, not an assumption."
            )
        else:
            description += (
                " v1.0: long-only, identical to the strategy deployed live for Natural Gas "
                "Mini (see the MCX page's RSI Strategy tab)."
            )
        if params.time_filter_enabled:
            description += (
                f" v3.0 Time Filter: no new entries within "
                f"{params.eia_window_before_minutes}min before / "
                f"{params.eia_window_after_minutes}min after the weekly EIA Natural Gas "
                f"Storage Report (Thu 10:30 AM ET)."
            )
        if params.atr_filter_enabled:
            description += (
                f" v3.0 Volatility Filter: stop widened {params.atr_widen_factor:g}x when "
                f"ATR >= {params.atr_elevated_multiple:g}x its {params.atr_avg_period}-bar "
                f"average; entry skipped entirely when ATR >= {params.atr_extreme_multiple:g}x."
            )
        if params.regime_filter_enabled:
            description += (
                f" v2.1 Regime Filter (experimental): entries skipped entirely unless "
                f"ADX(14) < {params.regime_adx_max:g} -- requires a non-trending/ranging "
                f"market, since RSI reversion's worst trades come from fighting a real trend."
            )
        if params.partial_exit_enabled:
            description += (
                f" v4.0 Partial Profit-Taking (experimental): {params.partial_exit_fraction * 100:g}% of "
                f"the position is closed at the normal target, and the remainder runs with no "
                f"fixed target -- only the stop/trailing-stop/RSI exit -- so a trade that keeps "
                f"extending captures more of the move."
            )

        candidate = StrategyCandidate(
            id=StrategyCandidate.new_id(),
            name=f"RSI-14 Reversion ({params.oversold:g}/{params.overbought:g}) {version}"
            + (" [Long+Short]" if params.allow_short else " [Long-only]")
            + (" [Time+Vol Filters]" if params.time_filter_enabled or params.atr_filter_enabled else "")
            + (" [Regime Filter]" if params.regime_filter_enabled else "")
            + (" [Partial Exit]" if params.partial_exit_enabled else ""),
            family="rsi_reversion_v2",
            description=description,
            params={
                "period": params.period,
                "oversold": params.oversold,
                "overbought": params.overbought,
                "allow_short": int(params.allow_short),
                "time_filter_enabled": int(params.time_filter_enabled),
                "atr_filter_enabled": int(params.atr_filter_enabled),
                "regime_filter_enabled": int(params.regime_filter_enabled),
                "partial_exit_enabled": int(params.partial_exit_enabled),
            },
            stop_loss_pct=params.stop_loss_pct,
            target_pct=params.target_pct,
            trailing_stop_pct=params.trailing_stop_pct,
            position_size_pct=2.0,
        )
        return StrategyLabResult(
            id=StrategyLabResult.new_id(),
            run_id=run_id,
            candidate=candidate,
            full_metrics=full_metrics,
            walk_forward=walk_forward,
            composite_score=score,
            equity_curve=outcome.equity_curve,
            drawdown_curve=drawdown_curve(outcome.equity_curve),
            trades=outcome.trades,
        )

    return await asyncio.to_thread(work)


def _custom_strategy_stability(train: BacktestMetrics, test: BacktestMetrics) -> float:
    """Same scoring shape as walk_forward._stability_score, duplicated here
    rather than imported since that one is coupled to the single-timeframe
    StrategyCandidate-based run_backtest, not these dedicated hand-designed
    engines (trend_pullback, opening_range_breakout). Shared across both."""
    if test.total_trades == 0:
        return 0.0
    if train.sharpe_ratio > 0:
        sharpe_retention = max(0.0, min(test.sharpe_ratio / train.sharpe_ratio, 1.0))
    else:
        sharpe_retention = 1.0 if test.sharpe_ratio >= 0 else 0.0
    dd_diff = abs(test.max_drawdown_pct - train.max_drawdown_pct)
    drawdown_consistency = max(0.0, 1 - dd_diff / max(train.max_drawdown_pct, 1.0))
    sign_agreement = 1.0 if (test.net_pnl > 0) == (train.net_pnl > 0) else 0.0
    score = 100 * (0.5 * sharpe_retention + 0.3 * drawdown_consistency + 0.2 * sign_agreement)
    return round(max(0.0, min(100.0, score)), 1)

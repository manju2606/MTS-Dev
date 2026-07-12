"""APScheduler background jobs for the discovery engine.

The scheduler starts automatically during FastAPI lifespan and runs the
full discovery scan every 5 minutes on NSE trading days (Mon–Fri 09:10–15:35 IST).
A news-only refresh runs every 15 minutes from 08:00–16:00 IST to capture
pre/post-market news.

The scheduler is disabled automatically when ENVIRONMENT=testing.
"""

import asyncio
from datetime import UTC, datetime, timedelta, timezone

import structlog
from apscheduler.events import EVENT_JOB_ERROR, JobExecutionEvent
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings

log = structlog.get_logger()

_IST = timezone(timedelta(hours=5, minutes=30))

_scheduler: AsyncIOScheduler | None = None
_scan_running = False
_last_scan_at: datetime | None = None
_last_scan_count = 0

# Held open for the process lifetime once acquired — see try_acquire_scheduler_lock.
_lock_conn = None

# Arbitrary fixed key for the "only one worker runs the scheduler" advisory lock.
_SCHEDULER_LOCK_KEY = 727384910


async def try_acquire_scheduler_lock() -> bool:
    """Session-level Postgres advisory lock so only one process runs the
    scheduler when uvicorn is started with multiple workers — otherwise every
    cron job fires once per worker (e.g. duplicate hourly reports/emails).

    Fails open (returns True) if the lock check itself errors, since a
    transient DB hiccup here shouldn't silently disable all scheduled jobs.
    """
    import asyncpg

    from app.core.config import settings

    global _lock_conn
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").split("?")[0]
    try:
        conn = await asyncpg.connect(dsn)
        acquired = await conn.fetchval("SELECT pg_try_advisory_lock($1)", _SCHEDULER_LOCK_KEY)
    except Exception as exc:
        log.warning("scheduler.lock.error", error=str(exc))
        return True

    if acquired:
        _lock_conn = conn  # keep the session open to hold the lock for the process lifetime
        return True
    await conn.close()
    log.info("scheduler.lock.skipped", reason="another worker already holds the scheduler lock")
    return False


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler


def is_scan_running() -> bool:
    return _scan_running


def last_scan_info() -> tuple[datetime | None, int]:
    return _last_scan_at, _last_scan_count


async def _run_golden_stock_scan() -> None:
    """Every 15 min, 09:30-15:00 IST weekdays: run Golden Stock Intraday scan."""
    try:
        from app.services.golden_stock_service import run_and_save_golden_stock

        await run_and_save_golden_stock()
    except Exception as exc:
        log.error("scheduler.golden_stock.error", error=str(exc))


async def _resolve_btst_outcomes() -> None:
    """10:00 IST weekdays: resolve yesterday's Intraday pick outcomes."""
    try:
        from datetime import date, timedelta

        from app.services.golden_stock_service import resolve_btst_outcomes

        yesterday = (date.today() - timedelta(days=1)).isoformat()
        count = await resolve_btst_outcomes(yesterday)
        log.info("scheduler.btst_resolve.done", date=yesterday, updated=count)
    except Exception as exc:
        log.error("scheduler.btst_resolve.error", error=str(exc))


async def _run_btst_scan() -> None:
    """14:00 IST weekdays: run the BTST (Buy Today, Sell Tomorrow) scan."""
    try:
        from app.services.btst_service import run_and_save_btst

        await run_and_save_btst()
    except Exception as exc:
        log.error("scheduler.btst_scan.error", error=str(exc))


async def _resolve_btst_pick_outcomes() -> None:
    """15:35 IST weekdays: resolve yesterday's BTST picks against today's close."""
    try:
        from datetime import date, timedelta

        from app.services.btst_service import resolve_btst_outcomes

        yesterday = (date.today() - timedelta(days=1)).isoformat()
        count = await resolve_btst_outcomes(yesterday)
        log.info("scheduler.btst_pick_resolve.done", date=yesterday, updated=count)
    except Exception as exc:
        log.error("scheduler.btst_pick_resolve.error", error=str(exc))


async def _run_sotd_generate() -> None:
    """09:30 IST weekdays: pick the day's best stock and optionally auto-trade it."""
    from app.services.stock_of_day_service import generate_and_save_daily_pick

    await generate_and_save_daily_pick()


async def _run_sotd_price_check() -> None:
    """Every 5 minutes during market hours: check if SotD SL/target hit."""
    from app.services.stock_of_day_service import run_sotd_price_check

    await run_sotd_price_check()


async def _run_sotd_expire() -> None:
    """15:35 IST weekdays: expire any still-open SotD positions."""
    from app.services.stock_of_day_service import expire_open_picks

    await expire_open_picks()


async def _run_dsws_generate() -> None:
    """Every 30 min, 09:00-16:00 IST weekdays: bucket today's Discovery Engine
    picks by signal strength (Strong Buy/Buy/Sell/Strong Sell) and email the
    watchlist to active recipients. Runs 15s after full_scan's own slot so
    today's discovery scores are already saved."""
    try:
        from app.services.dsws_service import generate_daily_watchlist

        await generate_daily_watchlist()
    except Exception as exc:
        log.error("scheduler.dsws_generate.error", error=str(exc))


async def _run_dsws_track() -> None:
    """Every 30 min, 10:00-15:30 IST weekdays: record a price checkpoint for
    every pick in today's DSWS watchlist."""
    try:
        from app.services.dsws_service import track_checkpoint

        await track_checkpoint()
    except Exception as exc:
        log.error("scheduler.dsws_track.error", error=str(exc))


async def _run_dsws_close() -> None:
    """15:35:30 IST weekdays: close out today's DSWS watchlist using each
    pick's last checkpoint as its close price."""
    try:
        from app.services.dsws_service import close_out_day

        await close_out_day()
    except Exception as exc:
        log.error("scheduler.dsws_close.error", error=str(exc))


async def _resolve_forecast_accuracy() -> None:
    """16:30 IST weekdays: fill actual prices into today's forecast records."""
    from datetime import date

    try:
        from app.infra.db.repositories.forecast_repo import ForecastRepository

        repo = ForecastRepository()
        updated = await repo.resolve_predictions_for_date(date.today().isoformat())
        log.info("scheduler.forecast_accuracy.done", updated=updated)
    except Exception as exc:
        log.error("scheduler.forecast_accuracy.error", error=str(exc))


async def _run_sentiment_snapshot() -> None:
    """15:35 IST weekdays: capture today's actual market sentiment and, if this
    week has a forecast, resolve today's forecast day against it."""
    try:
        from app.services.sentiment_forecast_service import compute_daily_snapshot

        snap = await compute_daily_snapshot()
        log.info("scheduler.sentiment_snapshot.done", date=snap.date, label=snap.label)
    except Exception as exc:
        log.error("scheduler.sentiment_snapshot.error", error=str(exc))


async def _run_weekly_sentiment_forecast() -> None:
    """09:00 IST Monday: generate this week's Mon-Fri sentiment forecast."""
    try:
        from app.services.sentiment_forecast_service import generate_weekly_forecast

        forecast = await generate_weekly_forecast()
        log.info("scheduler.weekly_sentiment_forecast.done", week_start=forecast.week_start)
    except Exception as exc:
        log.error("scheduler.weekly_sentiment_forecast.error", error=str(exc))


async def _run_portfolio_summary_snapshot() -> None:
    """15:36 IST weekdays: store today's per-user, per-portfolio Assistant
    Summary snapshot so a specific past date can be looked up later via the
    date picker, instead of recomputed from a rolling yfinance window that
    only knows "now"."""
    try:
        from app.infra.db.repositories.holdings_repo import HoldingsRepository
        from app.infra.db.repositories.portfolio_summary_repo import PortfolioSummaryRepository
        from app.services.portfolio_summary_service import compute_portfolio_summary

        today = datetime.now(UTC).astimezone(_IST).strftime("%Y-%m-%d")
        keys = await HoldingsRepository().list_all_portfolio_keys()
        repo = PortfolioSummaryRepository()
        stored = 0
        for user_id, portfolio_id in keys:
            try:
                summary = await compute_portfolio_summary(user_id, portfolio_id, "day")
                if summary.get("has_data"):
                    await repo.save_snapshot(user_id, portfolio_id, today, summary)
                    stored += 1
            except Exception as exc:
                log.warning(
                    "scheduler.portfolio_summary.portfolio_error",
                    user_id=user_id,
                    portfolio_id=portfolio_id,
                    error=str(exc),
                )
            # yf.download() inside compute_portfolio_summary is a synchronous,
            # blocking call -- yield the loop between portfolios so a long list
            # doesn't starve the event loop for the whole job's duration.
            await asyncio.sleep(0)
        log.info(
            "scheduler.portfolio_summary.done", date=today, portfolios=len(keys), stored=stored
        )
    except Exception as exc:
        log.error("scheduler.portfolio_summary.error", error=str(exc))


async def _run_portfolio_ohlc_snapshot() -> None:
    """15:37 IST weekdays: store today's per-user, per-portfolio OHLC
    snapshot (Open/High/Low/Close, 52w high/low, weekly/monthly change) as a
    historical record of that trading day for every holding."""
    try:
        from app.infra.db.repositories.holdings_repo import HoldingsRepository
        from app.infra.db.repositories.portfolio_ohlc_repo import PortfolioOhlcRepository
        from app.services.portfolio_ohlc_service import compute_portfolio_ohlc

        today = datetime.now(UTC).astimezone(_IST).strftime("%Y-%m-%d")
        keys = await HoldingsRepository().list_all_portfolio_keys()
        repo = PortfolioOhlcRepository()
        stored = 0
        for user_id, portfolio_id in keys:
            try:
                ohlc = await compute_portfolio_ohlc(user_id, portfolio_id)
                if ohlc.get("has_data"):
                    await repo.save_snapshot(user_id, portfolio_id, today, ohlc)
                    stored += 1
            except Exception as exc:
                log.warning(
                    "scheduler.portfolio_ohlc.portfolio_error",
                    user_id=user_id,
                    portfolio_id=portfolio_id,
                    error=str(exc),
                )
            # yf.download() inside compute_portfolio_ohlc is a synchronous,
            # blocking call -- yield the loop between portfolios so a long list
            # doesn't starve the event loop for the whole job's duration.
            await asyncio.sleep(0)
        log.info("scheduler.portfolio_ohlc.done", date=today, portfolios=len(keys), stored=stored)
    except Exception as exc:
        log.error("scheduler.portfolio_ohlc.error", error=str(exc))


async def _run_mcx_trend_check() -> None:
    """Every 15 min, 09:00-23:30 IST weekdays (MCX trades well past NSE
    hours): recompute the NG/NGMini trend ladder for every connected user,
    persist it, and email + in-app notify on any regime change or
    weakening trend (see mcx_trend_service.py)."""
    try:
        from app.infra.brokers import session_store
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS
        from app.services.mcx_trend_service import compute_and_store_snapshot

        user_ids = await session_store.list_connected_user_ids()
        checked, alerted = 0, 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_CONTRACTS:
                try:
                    result = await compute_and_store_snapshot(user_id, contract)
                    checked += 1
                    if result.get("changes"):
                        alerted += 1
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_trend.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
        log.info(
            "scheduler.mcx_trend.done", users=len(user_ids), checked=checked, alerted=alerted
        )
    except Exception as exc:
        log.error("scheduler.mcx_trend.error", error=str(exc))


_MCX_PREDICTION_PERIODS = ("1m", "5m", "15m", "30m", "1h", "4h", "6h", "8h")
_MCX_CALENDAR_PREDICTION_PERIODS = ("1Wk", "1Mo")


async def _run_mcx_prediction_check() -> None:
    """Every 5 min, 09:00-23:30 IST weekdays: generate/resolve NG/NGMini
    price predictions for every connected user across the Minutes/15 Mins/
    30 Mins/Hours accuracy-table columns (see mcx_prediction_service.py).
    5 min (not 15) because the "Minutes" (1m) and "30 Mins" columns need
    tighter cadence to keep a continuous trail -- each generation only
    forecasts HORIZON candles ahead (6 minutes for the 1m column), so a
    longer gap between runs would leave holes in that column's history.

    Runs independently of which frontend tab (if any) is open -- prediction
    generation used to be purely UI-triggered (a side effect of the GET
    /predict call), so the accuracy table would silently stop advancing for
    hours whenever nobody happened to have that tab open."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
        from app.services.mcx_prediction_service import get_prediction
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS

        repo = McxPredictionRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_CONTRACTS:
                for period in _MCX_PREDICTION_PERIODS:
                    try:
                        await get_prediction(user_id, contract, period, repo)
                        checked += 1
                    except Exception as exc:
                        log.warning(
                            "scheduler.mcx_prediction.contract_error",
                            user_id=user_id,
                            contract=contract,
                            period=period,
                            error=str(exc),
                        )
                    await asyncio.sleep(0)
        log.info("scheduler.mcx_prediction.done", users=len(user_ids), checked=checked)
    except Exception as exc:
        log.error("scheduler.mcx_prediction.error", error=str(exc))


async def _run_mcx_candle_collect() -> None:
    """Every 5 min, 09:00-23:30 IST weekdays: persist closed 5-minute OHLCV
    candles for every tracked NG + Metals contract to Mongo (mcx_candles).

    mcx_service.get_history()/mcx_metals_service.get_metal_history() already
    fetch this from Kite on every call but never store it -- the prediction
    heuristic re-fetches and discards the same window each time, so there is
    currently no accumulated price history anywhere to eventually train a
    real model against. This job is the minimal fix: fetch once, upsert.

    Candle data is contract-level, not user-level, so unlike the trend/
    prediction checks above this only needs *one* connected user's broker
    session to fetch it -- looping over every connected user would just
    fetch and upsert the identical candles N times for no benefit."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_candle_repo import McxCandleRepository
        from app.services.mcx_metals_service import (
            TRACKED_MCX_METALS_CONTRACTS,
            get_metal_history,
        )
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS, get_history

        user_ids = await session_store.list_connected_user_ids()
        if not user_ids:
            log.info("scheduler.mcx_candle_collect.skipped", reason="no_connected_users")
            return
        user_id = user_ids[0]

        repo = McxCandleRepository()
        await repo.ensure_indexes()

        fetched, written = 0, 0
        for contract in TRACKED_MCX_CONTRACTS:
            try:
                candles = await get_history(user_id, "5m", contract)
                written += await repo.upsert_many(contract, "5minute", candles)
                fetched += len(candles)
            except Exception as exc:
                log.warning(
                    "scheduler.mcx_candle_collect.ng_error", contract=contract, error=str(exc)
                )
            await asyncio.sleep(0)

        for contract in TRACKED_MCX_METALS_CONTRACTS:
            try:
                candles = await get_metal_history(user_id, "5m", contract)
                written += await repo.upsert_many(contract, "5minute", candles)
                fetched += len(candles)
            except Exception as exc:
                log.warning(
                    "scheduler.mcx_candle_collect.metals_error",
                    contract=contract,
                    error=str(exc),
                )
            await asyncio.sleep(0)

        log.info(
            "scheduler.mcx_candle_collect.done", user_id=user_id, fetched=fetched, written=written
        )
    except Exception as exc:
        log.error("scheduler.mcx_candle_collect.error", error=str(exc))


async def _run_mcx_calendar_prediction_check() -> None:
    """Once daily: generate/resolve NG/NGMini week and month predictions
    (see mcx_prediction_service.py's CALENDAR_PERIODS). Kept separate from
    the 5-min intraday job above -- resampling 5 years of daily candles into
    weekly/monthly bars doesn't need minute-level freshness, and re-fetching
    that much history every 5 min would just waste Kite API calls."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
        from app.services.mcx_prediction_service import get_prediction
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS

        repo = McxPredictionRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_CONTRACTS:
                for period in _MCX_CALENDAR_PREDICTION_PERIODS:
                    try:
                        await get_prediction(user_id, contract, period, repo)
                        checked += 1
                    except Exception as exc:
                        log.warning(
                            "scheduler.mcx_calendar_prediction.contract_error",
                            user_id=user_id,
                            contract=contract,
                            period=period,
                            error=str(exc),
                        )
                    await asyncio.sleep(0)
        log.info("scheduler.mcx_calendar_prediction.done", users=len(user_ids), checked=checked)
    except Exception as exc:
        log.error("scheduler.mcx_calendar_prediction.error", error=str(exc))


async def _run_mcx_dashboard_snapshot() -> None:
    """Once daily near MCX close: snapshot the NG Dashboard's full state
    (LTP/OHLCV/OI + both directions' AI score) for every connected user, so
    the Dashboard tab has a persistent Day/Week/Month history instead of
    only ever showing "right now" (see mcx_dashboard_snapshot_service.py).
    Weekly/monthly views are aggregated client-side from these daily rows.
    Also snapshots the Global Natural Gas Symbols table's full row set (NG,
    NGMINI, Henry Hub, Dutch TTF) the same way, once per user rather than
    per contract since one call already covers all four rows (see
    mcx_global_symbols_snapshot_service.py)."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_dashboard_snapshot_repo import (
            McxDashboardSnapshotRepository,
        )
        from app.infra.db.repositories.mcx_global_symbols_snapshot_repo import (
            McxGlobalSymbolsSnapshotRepository,
        )
        from app.services.mcx_dashboard_snapshot_service import build_and_save_snapshot
        from app.services.mcx_global_symbols_snapshot_service import (
            build_and_save_global_symbols_snapshot,
        )
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS

        repo = McxDashboardSnapshotRepository()
        global_repo = McxGlobalSymbolsSnapshotRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_CONTRACTS:
                try:
                    await build_and_save_snapshot(user_id, contract, repo)
                    checked += 1
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_dashboard_snapshot.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
            try:
                await build_and_save_global_symbols_snapshot(user_id, global_repo)
            except Exception as exc:
                log.warning(
                    "scheduler.mcx_dashboard_snapshot.global_symbols_error",
                    user_id=user_id,
                    error=str(exc),
                )
            await asyncio.sleep(0)
        log.info("scheduler.mcx_dashboard_snapshot.done", users=len(user_ids), checked=checked)
    except Exception as exc:
        log.error("scheduler.mcx_dashboard_snapshot.error", error=str(exc))


async def _run_mcx_signal_check() -> None:
    """Every 5 min, 09:00-23:30 IST weekdays: compute both directions' AI
    score for every connected user, log a new signal for whichever hits
    verdict=TRADE (if none is already open for that direction), and check
    every already-open signal against the live price for a target/stop-loss
    hit or expiry (see mcx_signal_service.py). Independent of any paper
    trade a user may or may not have placed off the same signal.

    Also persists each computed score to McxScoreCacheRepository -- see its
    own docstring on why (My Trading Dashboard reads this cache instead of
    recomputing the full score live for every contract on every poll)."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_score_cache_repo import McxScoreCacheRepository
        from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
        from app.services.mcx_ai_score_service import compute_ng_ai_score
        from app.services.mcx_service import TRACKED_MCX_CONTRACTS
        from app.services.mcx_signal_service import check_and_log_signal, resolve_open_signals

        repo = McxSignalRepository()
        score_cache = McxScoreCacheRepository()
        user_ids = await session_store.list_connected_user_ids()
        logged, closed = 0, 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_CONTRACTS:
                try:
                    for direction in ("BUY", "SELL"):
                        score = await compute_ng_ai_score(user_id, direction, 100_000.0, contract)
                        await score_cache.save_score(user_id, contract, direction, score)
                        if await check_and_log_signal(user_id, contract, direction, score, repo):
                            logged += 1
                    closed += await resolve_open_signals(user_id, contract, repo)
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_signal.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
        log.info("scheduler.mcx_signal.done", users=len(user_ids), logged=logged, closed=closed)
    except Exception as exc:
        log.error("scheduler.mcx_signal.error", error=str(exc))


async def _run_mcx_metals_trend_check() -> None:
    """Metals twin of _run_mcx_trend_check -- same 15-min cadence, iterates
    all 17 tracked metals contracts instead of NG's 7."""
    try:
        from app.infra.brokers import session_store
        from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS
        from app.services.mcx_metals_trend_service import compute_and_store_metal_snapshot

        user_ids = await session_store.list_connected_user_ids()
        checked, alerted = 0, 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_METALS_CONTRACTS:
                try:
                    result = await compute_and_store_metal_snapshot(user_id, contract)
                    checked += 1
                    if result.get("changes"):
                        alerted += 1
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_metals_trend.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
        log.info(
            "scheduler.mcx_metals_trend.done", users=len(user_ids), checked=checked, alerted=alerted
        )
    except Exception as exc:
        log.error("scheduler.mcx_metals_trend.error", error=str(exc))


async def _run_mcx_metals_prediction_check() -> None:
    """Metals twin of _run_mcx_prediction_check -- same 5-min cadence, same
    intraday period set."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
        from app.services.mcx_metals_prediction_service import get_metal_prediction
        from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS

        repo = McxPredictionRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_METALS_CONTRACTS:
                for period in _MCX_PREDICTION_PERIODS:
                    try:
                        await get_metal_prediction(user_id, contract, period, repo)
                        checked += 1
                    except Exception as exc:
                        log.warning(
                            "scheduler.mcx_metals_prediction.contract_error",
                            user_id=user_id,
                            contract=contract,
                            period=period,
                            error=str(exc),
                        )
                    await asyncio.sleep(0)
        log.info("scheduler.mcx_metals_prediction.done", users=len(user_ids), checked=checked)
    except Exception as exc:
        log.error("scheduler.mcx_metals_prediction.error", error=str(exc))


async def _run_mcx_metals_calendar_prediction_check() -> None:
    """Metals twin of _run_mcx_calendar_prediction_check -- once daily."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
        from app.services.mcx_metals_prediction_service import get_metal_prediction
        from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS

        repo = McxPredictionRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_METALS_CONTRACTS:
                for period in _MCX_CALENDAR_PREDICTION_PERIODS:
                    try:
                        await get_metal_prediction(user_id, contract, period, repo)
                        checked += 1
                    except Exception as exc:
                        log.warning(
                            "scheduler.mcx_metals_calendar_prediction.contract_error",
                            user_id=user_id,
                            contract=contract,
                            period=period,
                            error=str(exc),
                        )
                    await asyncio.sleep(0)
        log.info(
            "scheduler.mcx_metals_calendar_prediction.done", users=len(user_ids), checked=checked
        )
    except Exception as exc:
        log.error("scheduler.mcx_metals_calendar_prediction.error", error=str(exc))


async def _run_mcx_metals_dashboard_snapshot() -> None:
    """Metals twin of _run_mcx_dashboard_snapshot -- once daily near MCX
    close. No Global Symbols equivalent for metals (that's an NG-specific
    comparison widget, out of scope)."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_dashboard_snapshot_repo import (
            McxDashboardSnapshotRepository,
        )
        from app.services.mcx_metals_dashboard_snapshot_service import (
            build_and_save_metal_snapshot,
        )
        from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS

        repo = McxDashboardSnapshotRepository()
        user_ids = await session_store.list_connected_user_ids()
        checked = 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_METALS_CONTRACTS:
                try:
                    await build_and_save_metal_snapshot(user_id, contract, repo)
                    checked += 1
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_metals_dashboard_snapshot.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
        log.info(
            "scheduler.mcx_metals_dashboard_snapshot.done", users=len(user_ids), checked=checked
        )
    except Exception as exc:
        log.error("scheduler.mcx_metals_dashboard_snapshot.error", error=str(exc))


async def _run_mcx_metals_signal_check() -> None:
    """Metals twin of _run_mcx_signal_check -- same 5-min cadence, same
    score-cache persistence (see McxScoreCacheRepository's docstring)."""
    try:
        from app.infra.brokers import session_store
        from app.infra.db.repositories.mcx_score_cache_repo import McxScoreCacheRepository
        from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
        from app.services.mcx_metals_ai_score_service import compute_metal_ai_score
        from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS
        from app.services.mcx_metals_signal_service import (
            check_and_log_signal,
            resolve_open_metal_signals,
        )

        repo = McxSignalRepository()
        score_cache = McxScoreCacheRepository()
        user_ids = await session_store.list_connected_user_ids()
        logged, closed = 0, 0
        for user_id in user_ids:
            for contract in TRACKED_MCX_METALS_CONTRACTS:
                try:
                    for direction in ("BUY", "SELL"):
                        score = await compute_metal_ai_score(
                            user_id, direction, 100_000.0, contract
                        )
                        await score_cache.save_score(user_id, contract, direction, score)
                        if await check_and_log_signal(user_id, contract, direction, score, repo):
                            logged += 1
                    closed += await resolve_open_metal_signals(user_id, contract, repo)
                except Exception as exc:
                    log.warning(
                        "scheduler.mcx_metals_signal.contract_error",
                        user_id=user_id,
                        contract=contract,
                        error=str(exc),
                    )
                await asyncio.sleep(0)
        log.info(
            "scheduler.mcx_metals_signal.done", users=len(user_ids), logged=logged, closed=closed
        )
    except Exception as exc:
        log.error("scheduler.mcx_metals_signal.error", error=str(exc))


async def _run_mcx_ng_news_fetch() -> None:
    """Every 30 min, 07:00-23:30 IST (covers pre-market and the full MCX
    session): fetch international Natural Gas / energy news (OilPrice.com,
    Investing.com Commodities, Natural Gas Intel), keyword-filtered to NG
    relevance, and persist it -- feeds the NG-AI Pro score's News Filter
    category (see mcx_ai_score_service.py's _recent_ng_news, which reads
    this instead of hitting RSS feeds on every score computation) and the
    AI Signal tab's news panel. Not per-user -- the news itself doesn't
    depend on which user is asking, unlike everything else in this file."""
    try:
        from app.infra.db.repositories.mcx_news_repo import McxNewsRepository
        from app.infra.mcx.ng_news_fetcher import fetch_ng_news

        items = await fetch_ng_news()
        saved = await McxNewsRepository().save_news(items)
        log.info("scheduler.mcx_ng_news.done", fetched=len(items), new=saved)
    except Exception as exc:
        log.error("scheduler.mcx_ng_news.error", error=str(exc))


async def _run_mcx_metals_news_fetch() -> None:
    """Metals twin of _run_mcx_ng_news_fetch -- same cadence, same two
    underlying feeds (both already cover metals), a metals-relevance
    keyword filter instead of NG's gas-only one, and a separate Mongo
    collection (McxMetalsNewsRepository) so articles never mix with NG's."""
    try:
        from app.infra.db.repositories.mcx_metals_news_repo import McxMetalsNewsRepository
        from app.infra.mcx.metals_news_fetcher import fetch_metals_news

        items = await fetch_metals_news()
        saved = await McxMetalsNewsRepository().save_news(items)
        log.info("scheduler.mcx_metals_news.done", fetched=len(items), new=saved)
    except Exception as exc:
        log.error("scheduler.mcx_metals_news.error", error=str(exc))


async def _run_zerodha_token_check() -> None:
    """08:45 IST weekdays, before market open: validate every connected
    user's Zerodha session against Kite (not just "we have a token cached"
    -- Kite invalidates yesterday's token daily regardless of our own Redis
    TTL) and email + in-app notify whoever needs to reconnect, with a link
    to the manual login page (see zerodha_token_service.py for why this
    doesn't automate the login itself)."""
    try:
        from app.services.zerodha_token_service import check_and_notify_all

        checked, reminded = await check_and_notify_all()
        log.info("scheduler.zerodha_token_check.done", checked=checked, reminded=reminded)
    except Exception as exc:
        log.error("scheduler.zerodha_token_check.error", error=str(exc))


async def _run_position_check() -> None:
    """Delegate to the position monitor (import kept lazy to avoid circular imports)."""
    from app.infra.monitoring.position_monitor import run_position_check

    await run_position_check()


async def run_morning_report() -> None:
    """08:00 IST weekdays: scan the full universe then email today's picks."""
    log.info("scheduler.morning_report.start")
    await run_full_scan()
    try:
        from app.infra.email.report import send_daily_report

        await send_daily_report()
    except Exception as exc:
        log.error("scheduler.morning_report.email_error", error=str(exc))


async def run_news_refresh() -> None:
    """Fetch latest news and persist to MongoDB. Fast (~10 s)."""
    try:
        from app.infra.db.repositories.discovery_repo import DiscoveryRepository
        from app.infra.discovery.news_fetcher import fetch_all_news

        items = await fetch_all_news()
        repo = DiscoveryRepository()
        await repo.save_news(items)
        log.info("scheduler.news.done", count=len(items))
    except Exception as exc:
        log.error("scheduler.news.error", error=str(exc))


async def run_full_scan() -> None:
    """Full stock-universe scan: fetch quotes + TA + score + persist. Slower (~3–5 min)."""
    global _scan_running, _last_scan_at, _last_scan_count
    if _scan_running:
        log.info("scheduler.scan.skipped", reason="already_running")
        return
    _scan_running = True
    try:
        from app.infra.db.repositories.discovery_repo import DiscoveryRepository
        from app.infra.discovery.news_fetcher import fetch_all_news
        from app.infra.discovery.scoring_engine import score_stock
        from app.infra.discovery.universe import NSE_UNIVERSE

        log.info("scheduler.scan.start", universe_size=len(NSE_UNIVERSE))

        # 1. Fetch news + build per-symbol sentiment map
        news_items = await fetch_all_news()
        sym_sentiment: dict[str, list[float]] = {}
        for item in news_items:
            for sym in item.mentioned_symbols:
                sym_sentiment.setdefault(sym, []).append(item.sentiment_score)
        avg_sentiment = {sym: sum(scores) / len(scores) for sym, scores in sym_sentiment.items()}

        # 2. Score every stock with a bounded concurrency semaphore
        tasks = [score_stock(sym, name, avg_sentiment.get(sym, 0.0)) for sym, name in NSE_UNIVERSE]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        from app.domain.models.discovery import StockScore as _SS

        valid: list[_SS] = [r for r in results if isinstance(r, _SS)]

        # 3. Persist
        repo = DiscoveryRepository()
        await repo.save_scores(valid)
        await repo.save_news(news_items)

        _last_scan_at = datetime.now(UTC).replace(tzinfo=None)
        _last_scan_count = len(valid)
        log.info("scheduler.scan.done", scored=len(valid), skipped=len(NSE_UNIVERSE) - len(valid))
        from app.api.v1.discovery import invalidate_picks_cache

        invalidate_picks_cache()
    except Exception as exc:
        log.error("scheduler.scan.error", error=str(exc))
    finally:
        _scan_running = False


def _on_job_error(event: JobExecutionEvent) -> None:
    """APScheduler swallows job exceptions into its own event system by
    default -- a job silently failing every run would otherwise never surface
    anywhere except a grep through container logs. Report to Sentry (no-op if
    SENTRY_DSN unset) and log loudly either way."""
    log.error("scheduler.job_error", job_id=event.job_id, error=str(event.exception))
    if settings.SENTRY_DSN and event.exception is not None:
        import sentry_sdk

        sentry_sdk.capture_exception(event.exception)


def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
    _scheduler.add_listener(_on_job_error, EVENT_JOB_ERROR)

    # Full scan every 5 minutes during market hours
    _scheduler.add_job(
        run_full_scan,
        CronTrigger(
            day_of_week="mon-fri",
            hour="9-15",
            minute="*/5",
            second="30",
            timezone="Asia/Kolkata",
        ),
        id="full_scan",
        name="Full Discovery Scan",
        max_instances=1,
        misfire_grace_time=60,
    )

    # News refresh every 15 minutes, wider window (pre/post market)
    _scheduler.add_job(
        run_news_refresh,
        CronTrigger(
            day_of_week="mon-fri",
            hour="8-16",
            minute="*/15",
            timezone="Asia/Kolkata",
        ),
        id="news_refresh",
        name="News Refresh",
        max_instances=1,
        misfire_grace_time=120,
    )

    # Hourly scan + email report 08:15–15:15 IST (Mon–Fri)
    # misfire_grace_time=None: server restarts outside market hours won't fire stale jobs
    _scheduler.add_job(
        run_morning_report,
        CronTrigger(
            day_of_week="mon-fri",
            hour="8,9,10,11,12,13,14,15",
            minute=15,
            second=0,
            timezone="Asia/Kolkata",
        ),
        id="morning_report",
        name="Hourly Report (scan + email)",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Position monitor every 5 minutes during market hours
    _scheduler.add_job(
        _run_position_check,
        CronTrigger(
            day_of_week="mon-fri",
            hour="9-15",
            minute="*/5",
            second="0",
            timezone="Asia/Kolkata",
        ),
        id="position_monitor",
        name="Position Stop/Target Monitor",
        max_instances=1,
        misfire_grace_time=60,
    )

    # SotD: generate daily pick at 09:30 IST
    _scheduler.add_job(
        _run_sotd_generate,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=30, second=0, timezone="Asia/Kolkata"),
        id="sotd_generate",
        name="Stock of the Day — Generate Pick",
        max_instances=1,
        misfire_grace_time=300,
    )

    # SotD: check SL/target every 5 minutes during market hours
    _scheduler.add_job(
        _run_sotd_price_check,
        CronTrigger(
            day_of_week="mon-fri",
            hour="9-15",
            minute="*/5",
            second="45",
            timezone="Asia/Kolkata",
        ),
        id="sotd_price_check",
        name="Stock of the Day — SL/Target Check",
        max_instances=1,
        misfire_grace_time=60,
    )

    # SotD: expire open positions at market close 15:35 IST
    _scheduler.add_job(
        _run_sotd_expire,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=35, second=0, timezone="Asia/Kolkata"),
        id="sotd_expire",
        name="Stock of the Day — Expire Open Positions",
        max_instances=1,
        misfire_grace_time=None,
    )

    # DSWS: bucket today's Discovery Engine picks by signal strength every 30
    # min, 09:00-16:00 IST (Mon-Fri) — 15s after full_scan's own :00/:30 slot
    # so today's discovery scores exist first. Append-only + emails each run.
    _scheduler.add_job(
        _run_dsws_generate,
        CronTrigger(
            day_of_week="mon-fri", hour="9-15", minute="0,30", second=45, timezone="Asia/Kolkata"
        ),
        id="dsws_generate",
        name="DSWS — Generate Daily Watchlist (09:00-15:30)",
        max_instances=1,
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        _run_dsws_generate,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=0, second=45, timezone="Asia/Kolkata"),
        id="dsws_generate_close",
        name="DSWS — Generate Daily Watchlist (16:00)",
        max_instances=1,
        misfire_grace_time=300,
    )

    # DSWS: price checkpoint every 30 min, 10:00-15:30 IST
    _scheduler.add_job(
        _run_dsws_track,
        CronTrigger(
            day_of_week="mon-fri",
            hour="10-15",
            minute="0,30",
            second=15,
            timezone="Asia/Kolkata",
        ),
        id="dsws_track",
        name="DSWS — Price Checkpoint",
        max_instances=1,
        misfire_grace_time=None,
    )

    # DSWS: close out the day at 15:35:30 IST (after SotD expire / BTST resolve)
    _scheduler.add_job(
        _run_dsws_close,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=35, second=30, timezone="Asia/Kolkata"),
        id="dsws_close",
        name="DSWS — Close Out Day",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Resolve forecast accuracy daily at 16:30 IST (after market close)
    _scheduler.add_job(
        _resolve_forecast_accuracy,
        CronTrigger(
            day_of_week="mon-fri",
            hour=16,
            minute=30,
            timezone="Asia/Kolkata",
        ),
        id="forecast_accuracy_resolver",
        name="Resolve Forecast Accuracy",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Golden Stock Intraday scan every 15 min, 09:30-15:00 IST (Mon-Fri)
    _scheduler.add_job(
        _run_golden_stock_scan,
        CronTrigger(
            day_of_week="mon-fri", hour=9, minute="30,45", second=0, timezone="Asia/Kolkata"
        ),
        id="golden_stock_scan_open",
        name="Golden Stock Intraday Scan (09:30-09:45)",
        max_instances=1,
        misfire_grace_time=None,
    )
    _scheduler.add_job(
        _run_golden_stock_scan,
        CronTrigger(
            day_of_week="mon-fri",
            hour="10-14",
            minute="0,15,30,45",
            second=0,
            timezone="Asia/Kolkata",
        ),
        id="golden_stock_scan_mid",
        name="Golden Stock Intraday Scan (10:00-14:45)",
        max_instances=1,
        misfire_grace_time=None,
    )
    _scheduler.add_job(
        _run_golden_stock_scan,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=0, second=0, timezone="Asia/Kolkata"),
        id="golden_stock_scan_close",
        name="Golden Stock Intraday Scan (15:00)",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Resolve yesterday's Intraday pick outcomes at 10:00 IST (after previous day settlement)
    _scheduler.add_job(
        _resolve_btst_outcomes,
        CronTrigger(day_of_week="mon-fri", hour=10, minute=0, second=0, timezone="Asia/Kolkata"),
        id="btst_resolve",
        name="Resolve Intraday Pick Outcomes",
        max_instances=1,
        misfire_grace_time=None,
    )

    # BTST scan once daily at 14:00 IST (Mon-Fri)
    _scheduler.add_job(
        _run_btst_scan,
        CronTrigger(day_of_week="mon-fri", hour=14, minute=0, second=0, timezone="Asia/Kolkata"),
        id="btst_scan",
        name="BTST Scan (14:00)",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Resolve yesterday's BTST pick outcomes at 15:35 IST, against today's close
    _scheduler.add_job(
        _resolve_btst_pick_outcomes,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=35, second=0, timezone="Asia/Kolkata"),
        id="btst_pick_resolve",
        name="Resolve BTST Pick Outcomes",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Capture today's actual market sentiment at 15:35 IST (after market close)
    _scheduler.add_job(
        _run_sentiment_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=35, second=0, timezone="Asia/Kolkata"),
        id="sentiment_snapshot",
        name="Market Sentiment — Daily Snapshot",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Generate the week's Mon-Fri sentiment forecast at 09:00 IST every Monday
    _scheduler.add_job(
        _run_weekly_sentiment_forecast,
        CronTrigger(day_of_week="mon", hour=9, minute=0, second=0, timezone="Asia/Kolkata"),
        id="weekly_sentiment_forecast",
        name="Market Sentiment — Weekly Forecast",
        max_instances=1,
        misfire_grace_time=None,
    )

    # Store every portfolio's daily Assistant Summary snapshot at 15:36 IST
    # (a minute after the 15:35 cluster above, to avoid resource contention)
    _scheduler.add_job(
        _run_portfolio_summary_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=36, second=0, timezone="Asia/Kolkata"),
        id="portfolio_summary_snapshot",
        name="Portfolio Assistant — Daily Summary Snapshot",
        max_instances=1,
        misfire_grace_time=3600,
    )

    # Store every portfolio's daily OHLC snapshot at 15:37 IST (a minute
    # after the summary snapshot above, to avoid resource contention)
    _scheduler.add_job(
        _run_portfolio_ohlc_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=15, minute=37, second=0, timezone="Asia/Kolkata"),
        id="portfolio_ohlc_snapshot",
        name="Portfolio Assistant — Daily OHLC Snapshot",
        max_instances=1,
        misfire_grace_time=3600,
    )

    # MCX NG/NGMini trend-change check every 15 min, 09:00-23:45 IST weekdays
    # (MCX's commodity session runs well past NSE hours)
    _scheduler.add_job(
        _run_mcx_trend_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="0,15,30,45", second=5,
            timezone="Asia/Kolkata",
        ),
        id="mcx_trend_check",
        name="MCX — Trend Change Check + Alerts",
        max_instances=1,
        misfire_grace_time=300,
    )

    # MCX prediction generation/resolution every 5 min, 09:00-23:45 IST
    # weekdays -- keeps the accuracy table fresh regardless of frontend tab
    # state. Tighter cadence than the trend check (15 min) since the
    # Minutes/30-Mins accuracy columns need it to avoid gaps in their trail.
    _scheduler.add_job(
        _run_mcx_prediction_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="*/5", second=10,
            timezone="Asia/Kolkata",
        ),
        id="mcx_prediction_check",
        name="MCX — Prediction Generation + Accuracy Resolution",
        max_instances=1,
        misfire_grace_time=180,
    )

    # MCX candle history collection every 5 min, 09:00-23:45 IST weekdays --
    # persists the OHLCV window mcx_service.get_history()/get_metal_history()
    # already fetch from Kite on every prediction call but never store, so a
    # future ML model has actual accumulated price history to train against.
    _scheduler.add_job(
        _run_mcx_candle_collect,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="*/5", second=20,
            timezone="Asia/Kolkata",
        ),
        id="mcx_candle_collect",
        name="MCX — Candle History Collection",
        max_instances=1,
        misfire_grace_time=180,
    )

    # MCX week/month prediction generation once daily at market open --
    # separate, much less frequent job than the intraday one above (see
    # _run_mcx_calendar_prediction_check's own docstring for why).
    _scheduler.add_job(
        _run_mcx_calendar_prediction_check,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=5, second=0, timezone="Asia/Kolkata"),
        id="mcx_calendar_prediction_check",
        name="MCX — Week/Month Prediction Generation",
        max_instances=1,
        misfire_grace_time=3600,
    )

    # NG Dashboard daily snapshot near MCX close (23:45 IST) -- captures the
    # day's final LTP/OHLCV/OI + AI scores for the Day/Week/Month history
    # tables (weekly/monthly are aggregated client-side from these).
    _scheduler.add_job(
        _run_mcx_dashboard_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=23, minute=50, second=0, timezone="Asia/Kolkata"),
        id="mcx_dashboard_snapshot",
        name="MCX — NG Dashboard Daily Snapshot",
        max_instances=1,
        misfire_grace_time=3600,
    )

    # MCX AI trade-signal logging + resolution every 5 min, 09:00-23:30 IST
    # weekdays -- same cadence as the intraday prediction job.
    _scheduler.add_job(
        _run_mcx_signal_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="*/5", second=20,
            timezone="Asia/Kolkata",
        ),
        id="mcx_signal_check",
        name="MCX — AI Trade Signal Logging + Resolution",
        max_instances=1,
        misfire_grace_time=180,
    )

    # Metals twins of the five MCX jobs above -- same cadences, offset by a
    # few seconds so they don't fire in the same instant as the NG ones.
    _scheduler.add_job(
        _run_mcx_metals_trend_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="0,15,30,45", second=35,
            timezone="Asia/Kolkata",
        ),
        id="mcx_metals_trend_check",
        name="MCX Metals — Trend Change Check + Alerts",
        max_instances=1,
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        _run_mcx_metals_prediction_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="*/5", second=40,
            timezone="Asia/Kolkata",
        ),
        id="mcx_metals_prediction_check",
        name="MCX Metals — Prediction Generation + Accuracy Resolution",
        max_instances=1,
        misfire_grace_time=180,
    )
    _scheduler.add_job(
        _run_mcx_metals_calendar_prediction_check,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=6, second=0, timezone="Asia/Kolkata"),
        id="mcx_metals_calendar_prediction_check",
        name="MCX Metals — Week/Month Prediction Generation",
        max_instances=1,
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _run_mcx_metals_dashboard_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=23, minute=51, second=0, timezone="Asia/Kolkata"),
        id="mcx_metals_dashboard_snapshot",
        name="MCX Metals — Dashboard Daily Snapshot",
        max_instances=1,
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _run_mcx_metals_signal_check,
        CronTrigger(
            day_of_week="mon-fri", hour="9-23", minute="*/5", second=50,
            timezone="Asia/Kolkata",
        ),
        id="mcx_metals_signal_check",
        name="MCX Metals — AI Trade Signal Logging + Resolution",
        max_instances=1,
        misfire_grace_time=180,
    )

    # Zerodha daily token-validity check at 08:45 IST weekdays, ahead of the
    # 09:00 MCX session -- email + in-app notify if today's session needs a
    # manual reconnect (see _run_zerodha_token_check's own docstring).
    _scheduler.add_job(
        _run_zerodha_token_check,
        CronTrigger(day_of_week="mon-fri", hour=8, minute=45, second=0, timezone="Asia/Kolkata"),
        id="zerodha_token_check",
        name="Zerodha — Daily Token Validity Check",
        max_instances=1,
        misfire_grace_time=1800,
    )

    # International NG/energy news fetch every 30 min, 07:00-23:30 IST daily
    # (not user-scoped, and MCX's session runs weekdays but overnight/weekend
    # global gas news can still matter for Monday's open) -- feeds the NG-AI
    # Pro score's News Filter category and the AI Signal tab's news panel.
    _scheduler.add_job(
        _run_mcx_ng_news_fetch,
        CronTrigger(hour="7-23", minute="0,30", second=40, timezone="Asia/Kolkata"),
        id="mcx_ng_news_fetch",
        name="MCX — International NG News Fetch",
        max_instances=1,
        misfire_grace_time=600,
    )

    # Metals twin of the NG news fetch above -- same cadence, offset a few
    # seconds so they don't hit the same feeds in the same instant.
    _scheduler.add_job(
        _run_mcx_metals_news_fetch,
        CronTrigger(hour="7-23", minute="0,30", second=45, timezone="Asia/Kolkata"),
        id="mcx_metals_news_fetch",
        name="MCX — International Metals News Fetch",
        max_instances=1,
        misfire_grace_time=600,
    )

    _scheduler.start()
    log.info("scheduler.started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler.stopped")
    _scheduler = None


async def release_scheduler_lock() -> None:
    global _lock_conn
    if _lock_conn is not None:
        await _lock_conn.close()
        _lock_conn = None

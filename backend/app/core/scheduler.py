"""APScheduler background jobs for the discovery engine.

The scheduler starts automatically during FastAPI lifespan and runs the
full discovery scan every 5 minutes on NSE trading days (Mon–Fri 09:10–15:35 IST).
A news-only refresh runs every 15 minutes from 08:00–16:00 IST to capture
pre/post-market news.

The scheduler is disabled automatically when ENVIRONMENT=testing.
"""

import asyncio
from datetime import UTC, datetime

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

log = structlog.get_logger()

_scheduler: AsyncIOScheduler | None = None
_scan_running = False
_last_scan_at: datetime | None = None
_last_scan_count = 0


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
        avg_sentiment = {
            sym: sum(scores) / len(scores)
            for sym, scores in sym_sentiment.items()
        }

        # 2. Score every stock with a bounded concurrency semaphore
        tasks = [
            score_stock(sym, name, avg_sentiment.get(sym, 0.0))
            for sym, name in NSE_UNIVERSE
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        scores = [r for r in results if isinstance(r, object) and not isinstance(r, Exception) and r is not None]
        # mypy: filter properly
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


def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

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
        CronTrigger(day_of_week="mon-fri", hour=9, minute="30,45", second=0, timezone="Asia/Kolkata"),
        id="golden_stock_scan_open",
        name="Golden Stock Intraday Scan (09:30-09:45)",
        max_instances=1,
        misfire_grace_time=None,
    )
    _scheduler.add_job(
        _run_golden_stock_scan,
        CronTrigger(day_of_week="mon-fri", hour="10-14", minute="0,15,30,45", second=0, timezone="Asia/Kolkata"),
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

    _scheduler.start()
    log.info("scheduler.started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler.stopped")
    _scheduler = None

"""APScheduler background jobs for the discovery engine.

The scheduler starts automatically during FastAPI lifespan and runs the
full discovery scan every 5 minutes on NSE trading days (Mon–Fri 09:10–15:35 IST).
A news-only refresh runs every 15 minutes from 08:00–16:00 IST to capture
pre/post-market news.

The scheduler is disabled automatically when ENVIRONMENT=testing.
"""

import asyncio
from datetime import datetime, timezone

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

        _last_scan_at = datetime.now(timezone.utc).replace(tzinfo=None)
        _last_scan_count = len(valid)
        log.info("scheduler.scan.done", scored=len(valid), skipped=len(NSE_UNIVERSE) - len(valid))
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

    _scheduler.start()
    log.info("scheduler.started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler.stopped")
    _scheduler = None

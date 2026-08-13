"""Part 2 (Storage) + Part 5 (Alerts) orchestration for the Chartink
scan-link poller -- the *pull* half of the Chartink integration.

Deliberately thin: fetch_chartink_screener() (Part 1) gets the current
result set, then this hands straight off to
chartink_signal_service.process_chartink_alert() -- the exact same
scoring + chartink_candidates storage + email-alert pipeline the webhook
(the *push* half) already uses. Two ingestion paths, one candidate
table, one scoring engine, one alert channel -- see
chartink_scan_link.py's docstring for why.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import structlog

from app.domain.models.chartink_scan_link import ChartinkScanLink
from app.infra.scanner.chartink_poller import ChartinkFetchError, fetch_chartink_screener

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


async def _record_run(link_id: UUID, scan_name: str, status: str, count: int) -> None:
    """Update the scan link's "latest" snapshot fields AND append one row
    to the poll-run history log -- see ChartinkPollRun's docstring for why
    the two are kept separately (overwritten snapshot vs. append-only
    log)."""
    from app.domain.models.chartink_poll_run import ChartinkPollRun
    from app.infra.db.repositories.chartink_poll_run_repo import SQLChartinkPollRunRepository
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        await SQLChartinkScanLinkRepository(session).mark_polled(
            link_id, status=status, count=count
        )
        await SQLChartinkPollRunRepository(session).create(
            ChartinkPollRun(
                scan_link_id=link_id, scan_name=scan_name, status=status[:500], count=count
            )
        )


async def poll_scan_link(link: ChartinkScanLink) -> dict:
    """Fetch + score + store one scan link's current results. Never
    raises -- errors are caught, logged, and returned in the result dict
    so a scheduler polling many links in a loop can't have one bad link
    (dead URL, stale scan_clause) take the whole run down."""
    from app.services.chartink_signal_service import process_chartink_alert

    try:
        rows = await fetch_chartink_screener(link.url, link.scan_clause)
    except ChartinkFetchError as exc:
        log.warning("chartink_poll.fetch_failed", scan_name=link.scan_name, error=str(exc))
        await _record_run(link.id, link.scan_name, status=f"error: {exc}", count=0)
        return {"scan_name": link.scan_name, "ok": False, "error": str(exc), "scored": 0}

    if not rows:
        await _record_run(link.id, link.scan_name, status="ok: 0 results", count=0)
        return {"scan_name": link.scan_name, "ok": True, "scored": 0}

    symbols = [f"{r['symbol']}.NS" for r in rows]
    trigger_prices = [r["close"] for r in rows]
    triggered_at = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")

    candidates = await process_chartink_alert(
        link.scan_name, symbols, trigger_prices, triggered_at
    )

    await _record_run(link.id, link.scan_name, status="ok", count=len(candidates))

    log.info(
        "chartink_poll.done",
        scan_name=link.scan_name,
        fetched=len(rows),
        scored=len(candidates),
    )
    return {"scan_name": link.scan_name, "ok": True, "scored": len(candidates)}


_DUE_GRACE = timedelta(minutes=10)


def is_due(link: ChartinkScanLink, now: datetime | None = None) -> bool:
    """Whether a link's poll interval has elapsed -- used by both the
    scheduler job (only poll links that are actually due) and can be
    called standalone to check without side effects.

    _DUE_GRACE matters for a link whose poll_interval_minutes equals the
    scheduler's own checkpoint spacing (60 min, one run at each hour+15
    mark -- see scheduler.py's _run_chartink_scan_link_poll). With zero
    slack, any drift off that fixed grid -- a manual "Run Now" click, or
    just an earlier link in the same checkpoint run taking a few minutes
    to fetch+score before this one's last_polled_at gets set -- leaves
    elapsed a few minutes short of the full interval at the *next*
    checkpoint, silently skipping it for a whole extra hour. The grace
    absorbs that normal jitter without materially changing the meaning
    of a long interval (e.g. a 1440-min/daily link still needs ~23h50m
    elapsed, still effectively once a day)."""
    if not link.enabled:
        return False
    if link.last_polled_at is None:
        return True
    now = now or datetime.utcnow()
    elapsed = now - link.last_polled_at
    return elapsed >= timedelta(minutes=link.poll_interval_minutes) - _DUE_GRACE

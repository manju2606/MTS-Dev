"""Chartink scan-alert webhook receiver + read endpoints.

POST /chartink/webhook is hit directly by Chartink's own servers (no user
session), so it's secret-gated the same way Alertmanager's webhook is (see
alerting.py) rather than JWT-authenticated. The GET endpoints below are for
the (future) dashboard -- see services/chartink_signal_service.py for the
scoring pipeline this triggers.
"""

from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DBSession, require_role
from app.domain.models.chartink_candidate import ChartinkCandidate
from app.domain.models.chartink_scan_link import ChartinkScanLink
from app.domain.models.user import UserRole

router = APIRouter(prefix="/chartink", tags=["chartink"])


class CreateScanLinkRequest(BaseModel):
    scan_name: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=1000)
    poll_interval_minutes: int = Field(default=60, ge=5, le=1440)
    scan_clause: str | None = None


class UpdateScanLinkRequest(BaseModel):
    scan_name: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    poll_interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    enabled: bool | None = None
    scan_clause: str | None = None


class UpdateChartinkScoringConfigRequest(BaseModel):
    """All-optional patch, same shape as risk.py's UpdateRiskConfigRequest --
    only fields the caller actually sent get applied."""

    rsi_healthy_min: float | None = Field(default=None, ge=0, le=100)
    rsi_healthy_max: float | None = Field(default=None, ge=0, le=100)
    rsi_healthy_score: float | None = Field(default=None, ge=0, le=1)
    rsi_moderate_score: float | None = Field(default=None, ge=0, le=1)
    rsi_extended_score: float | None = Field(default=None, ge=0, le=1)
    adx_strong_threshold: float | None = Field(default=None, ge=0, le=100)
    adx_strong_score: float | None = Field(default=None, ge=0, le=1)
    adx_rising_threshold: float | None = Field(default=None, ge=0, le=100)
    adx_rising_score: float | None = Field(default=None, ge=0, le=1)
    adx_weak_score: float | None = Field(default=None, ge=0, le=1)
    vol_strong_threshold: float | None = Field(default=None, ge=0)
    vol_strong_score: float | None = Field(default=None, ge=0, le=1)
    vol_moderate_threshold: float | None = Field(default=None, ge=0)
    vol_moderate_score: float | None = Field(default=None, ge=0, le=1)
    vol_mild_threshold: float | None = Field(default=None, ge=0)
    vol_mild_score: float | None = Field(default=None, ge=0, le=1)
    vol_weak_score: float | None = Field(default=None, ge=0, le=1)
    macd_bullish_score: float | None = Field(default=None, ge=0, le=1)
    trend_score: float | None = Field(default=None, ge=0, le=1)
    atr_min_pct: float | None = Field(default=None, gt=0)
    atr_max_pct: float | None = Field(default=None, gt=0)
    atr_target_multiplier: float | None = Field(default=None, gt=0)


class PreviewScoreRequest(BaseModel):
    """Full (not partial) snapshot of the config form -- unlike the PATCH
    body, this scores against draft values that may not be saved yet, so
    every field must be present rather than falling back to the DB."""

    symbol: str
    rsi_healthy_min: float = Field(ge=0, le=100)
    rsi_healthy_max: float = Field(ge=0, le=100)
    rsi_healthy_score: float = Field(ge=0, le=1)
    rsi_moderate_score: float = Field(ge=0, le=1)
    rsi_extended_score: float = Field(ge=0, le=1)
    adx_strong_threshold: float = Field(ge=0, le=100)
    adx_strong_score: float = Field(ge=0, le=1)
    adx_rising_threshold: float = Field(ge=0, le=100)
    adx_rising_score: float = Field(ge=0, le=1)
    adx_weak_score: float = Field(ge=0, le=1)
    vol_strong_threshold: float = Field(ge=0)
    vol_strong_score: float = Field(ge=0, le=1)
    vol_moderate_threshold: float = Field(ge=0)
    vol_moderate_score: float = Field(ge=0, le=1)
    vol_mild_threshold: float = Field(ge=0)
    vol_mild_score: float = Field(ge=0, le=1)
    vol_weak_score: float = Field(ge=0, le=1)
    macd_bullish_score: float = Field(ge=0, le=1)
    trend_score: float = Field(ge=0, le=1)
    atr_min_pct: float = Field(gt=0)
    atr_max_pct: float = Field(gt=0)
    atr_target_multiplier: float = Field(gt=0)


def _candidate_dict(c: ChartinkCandidate) -> dict:
    return {
        "id": str(c.id),
        "scan_name": c.scan_name,
        "symbol": c.symbol,
        "trigger_price": c.trigger_price,
        "signal": c.signal,
        "confidence": c.confidence,
        "entry_price": c.entry_price,
        "stop_loss": c.stop_loss,
        "target": c.target,
        "risk_reward_ratio": c.risk_reward_ratio,
        "holding_period": c.holding_period,
        "explanation": c.explanation,
        "rsi": c.rsi,
        "adx": c.adx,
        "volume_ratio": c.volume_ratio,
        "batch_id": str(c.batch_id) if c.batch_id else None,
        "received_at": c.received_at.isoformat(),
    }


def _scan_link_dict(link: ChartinkScanLink) -> dict:
    return {
        "id": str(link.id),
        "scan_name": link.scan_name,
        "url": link.url,
        "poll_interval_minutes": link.poll_interval_minutes,
        "enabled": link.enabled,
        "scan_clause": link.scan_clause,
        "last_polled_at": link.last_polled_at.isoformat() if link.last_polled_at else None,
        "last_poll_status": link.last_poll_status,
        "last_poll_count": link.last_poll_count,
        "created_at": link.created_at.isoformat(),
    }


@router.post("/webhook")
async def chartink_webhook(
    body: dict = Body(...),
    authorization: str | None = Header(default=None),
) -> dict:
    import structlog

    from app.core.config import settings

    log = structlog.get_logger()

    if settings.CHARTINK_WEBHOOK_SECRET:
        expected = f"Bearer {settings.CHARTINK_WEBHOOK_SECRET}"
        if authorization != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret"
            )
    else:
        log.warning(
            "chartink.webhook.no_secret_configured",
            hint="Set CHARTINK_WEBHOOK_SECRET to prevent unauthenticated callers "
            "from injecting fake candidates (this endpoint is proxied publicly "
            "along with the rest of /api/).",
        )

    stocks = [s.strip() for s in str(body.get("stocks", "")).split(",") if s.strip()]
    if not stocks:
        return {"received": 0, "scored": 0}

    raw_prices = [p.strip() for p in str(body.get("trigger_prices", "")).split(",")]
    trigger_prices: list[float] = []
    for p in raw_prices:
        try:
            trigger_prices.append(float(p))
        except ValueError:
            trigger_prices.append(0.0)
    if len(trigger_prices) < len(stocks):
        trigger_prices += [0.0] * (len(stocks) - len(trigger_prices))

    symbols = [f"{s}.NS" for s in stocks]
    scan_name = str(body.get("scan_name") or body.get("alert_name") or "Chartink Scan")
    triggered_at = str(body.get("triggered_at") or "")

    from app.services.chartink_signal_service import process_chartink_alert

    candidates = await process_chartink_alert(scan_name, symbols, trigger_prices, triggered_at)

    log.info(
        "chartink.webhook.processed",
        scan_name=scan_name,
        received=len(symbols),
        scored=len(candidates),
    )
    return {"received": len(symbols), "scored": len(candidates)}


@router.get("/candidates")
async def list_candidates(
    current_user: CurrentUser,
    db: DBSession,
    scan_name: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository

    repo = SQLChartinkCandidateRepository(db)
    candidates = await repo.list_recent(scan_name=scan_name, limit=limit)
    return [_candidate_dict(c) for c in candidates]


@router.get("/today")
async def list_today(current_user: CurrentUser, db: DBSession) -> list[dict]:
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository

    repo = SQLChartinkCandidateRepository(db)
    candidates = await repo.list_today()
    return [_candidate_dict(c) for c in candidates]


@router.get("/config")
async def get_scoring_config(current_user: CurrentUser, db: DBSession) -> dict:
    from app.infra.db.repositories.chartink_scoring_config_repo import (
        SQLChartinkScoringConfigRepository,
    )

    repo = SQLChartinkScoringConfigRepository(db)
    return asdict(await repo.get())


@router.patch("/config", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def update_scoring_config(
    body: UpdateChartinkScoringConfigRequest,
    current_user: CurrentUser,
    db: DBSession,
) -> dict:
    from app.infra.db.repositories.chartink_scoring_config_repo import (
        SQLChartinkScoringConfigRepository,
    )

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    repo = SQLChartinkScoringConfigRepository(db)
    updated = await repo.update(patch)
    return asdict(updated)


@router.post("/config/preview", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def preview_scoring_config(body: PreviewScoreRequest, current_user: CurrentUser) -> dict:
    """Manually run the scorer against a real symbol using draft (possibly
    unsaved) parameter values -- lets an admin see the effect of an edit
    before committing it via PATCH /config."""
    from app.domain.models.chartink_scoring_config import ChartinkScoringConfig
    from app.services.chartink_signal_service import preview_score

    fields = body.model_dump(exclude={"symbol"})
    cfg = ChartinkScoringConfig(**fields)

    symbol = body.symbol.strip().upper()
    if "." not in symbol:
        symbol = f"{symbol}.NS"

    try:
        return await preview_score(symbol, cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ── Scan-link poller (the "pull" half, alongside the webhook) ───────────────


@router.get("/scan-links")
async def list_scan_links(current_user: CurrentUser, db: DBSession) -> list[dict]:
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )

    repo = SQLChartinkScanLinkRepository(db)
    links = await repo.list_all()
    return [_scan_link_dict(link) for link in links]


@router.post("/scan-links", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def create_scan_link(
    body: CreateScanLinkRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )

    link = ChartinkScanLink(
        scan_name=body.scan_name,
        url=body.url,
        poll_interval_minutes=body.poll_interval_minutes,
        scan_clause=body.scan_clause,
    )
    repo = SQLChartinkScanLinkRepository(db)
    created = await repo.create(link)
    return _scan_link_dict(created)


@router.patch("/scan-links/{link_id}", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def update_scan_link(
    link_id: UUID, body: UpdateScanLinkRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    repo = SQLChartinkScanLinkRepository(db)
    updated = await repo.update(link_id, patch)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan link not found")
    return _scan_link_dict(updated)


@router.delete("/scan-links/{link_id}", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def delete_scan_link(link_id: UUID, current_user: CurrentUser, db: DBSession) -> dict:
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )

    repo = SQLChartinkScanLinkRepository(db)
    deleted = await repo.delete(link_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan link not found")
    return {"deleted": True}


@router.post(
    "/scan-links/{link_id}/poll-now", dependencies=[Depends(require_role(UserRole.ADMIN))]
)
async def poll_scan_link_now(link_id: UUID, current_user: CurrentUser, db: DBSession) -> dict:
    """Manually run one scan link right now, regardless of its
    poll_interval_minutes schedule -- the "Run Now" workflow."""
    from app.infra.db.repositories.chartink_scan_link_repo import (
        SQLChartinkScanLinkRepository,
    )
    from app.services.chartink_poll_service import poll_scan_link

    repo = SQLChartinkScanLinkRepository(db)
    link = await repo.get_by_id(link_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan link not found")

    return await poll_scan_link(link)


@router.get("/compare")
async def compare_scan_batches(
    current_user: CurrentUser, db: DBSession, scan_name: str = Query(...)
) -> dict:
    """Part 3 (Comparison Logic): new/persistent/dropped candidates
    between this scan_name's two most recent batches (webhook delivery or
    scan-link poll -- either way, same chartink_candidates table)."""
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository

    repo = SQLChartinkCandidateRepository(db)
    result = await repo.compare_latest_batches(scan_name)
    return {
        **result,
        "new": [_candidate_dict(c) for c in result["new"]],
        "persistent": [_candidate_dict(c) for c in result["persistent"]],
        "dropped": [_candidate_dict(c) for c in result["dropped"]],
    }


@router.get("/breakouts")
async def list_breakouts(
    current_user: CurrentUser,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    """Part 5 (Alerts): the "separate list" of stocks that have appeared in
    a scan 3 times in a row, each enriched with a live LTP/change/day-week-
    month P&L -- see chartink_signal_service.get_breakout_watchlist()."""
    from app.services.chartink_signal_service import get_breakout_watchlist

    return await get_breakout_watchlist(limit)

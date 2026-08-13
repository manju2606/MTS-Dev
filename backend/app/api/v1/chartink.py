"""Chartink scan-alert webhook receiver + read endpoints.

POST /chartink/webhook is hit directly by Chartink's own servers (no user
session), so it's secret-gated the same way Alertmanager's webhook is (see
alerting.py) rather than JWT-authenticated. The GET endpoints below are for
the (future) dashboard -- see services/chartink_signal_service.py for the
scoring pipeline this triggers.
"""

from dataclasses import asdict

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DBSession, require_role
from app.domain.models.chartink_candidate import ChartinkCandidate
from app.domain.models.user import UserRole

router = APIRouter(prefix="/chartink", tags=["chartink"])


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
        "received_at": c.received_at.isoformat(),
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

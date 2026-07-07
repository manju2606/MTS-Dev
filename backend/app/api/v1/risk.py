from dataclasses import asdict, replace
from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, RiskDep, TradeDep, set_user_risk_config
from app.domain.models.trade import TradeStatus

router = APIRouter(prefix="/risk", tags=["risk-engine"])


class ValidateRequest(BaseModel):
    signal: str
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    quantity: int = Field(ge=1)


class UpdateRiskConfigRequest(BaseModel):
    capital: float | None = Field(default=None, gt=0)
    max_position_pct: float | None = Field(default=None, gt=0, le=1)
    max_daily_loss_pct: float | None = Field(default=None, gt=0, le=1)
    max_drawdown_pct: float | None = Field(default=None, gt=0, le=1)
    min_risk_reward: float | None = Field(default=None, gt=0)
    max_stop_pct: float | None = Field(default=None, gt=0, le=1)


@router.post("/validate")
async def validate_trade(
    body: ValidateRequest,
    current_user: CurrentUser,
    risk_engine: RiskDep,
) -> dict:
    result = risk_engine.validate_trade(
        signal=body.signal,
        entry=body.entry_price,
        stop_loss=body.stop_loss,
        target=body.target,
        quantity=body.quantity,
    )
    return asdict(result)


@router.get("/config")
async def get_risk_config(current_user: CurrentUser, risk_engine: RiskDep) -> dict:
    return asdict(risk_engine.config)


@router.patch("/config")
async def update_risk_config(
    body: UpdateRiskConfigRequest,
    current_user: CurrentUser,
    risk_engine: RiskDep,
) -> dict:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    new_config = replace(risk_engine.config, **updates)
    set_user_risk_config(str(current_user.id), new_config)
    return asdict(new_config)


@router.get("/status")
async def get_risk_status(
    current_user: CurrentUser,
    repo: TradeDep,
    risk_engine: RiskDep,
) -> dict:
    all_trades = await repo.list_by_user(current_user.id)
    open_trades = [t for t in all_trades if t.status == TradeStatus.OPEN]

    today = datetime.now(UTC).date()
    daily_pnl = sum(
        t.pnl
        for t in all_trades
        if t.status == TradeStatus.CLOSED
        and t.closed_at is not None
        and t.closed_at.date() == today
        and t.pnl is not None
    )

    # Trip circuit breaker when daily loss exceeds configured limit
    cfg = risk_engine.config
    max_daily_loss = cfg.capital * cfg.max_daily_loss_pct
    circuit_breaker_active = daily_pnl < 0 and abs(daily_pnl) >= max_daily_loss

    # Also trip on max drawdown breach (total unrealised + realised)
    all_closed_pnl = sum(
        t.pnl for t in all_trades if t.status == TradeStatus.CLOSED and t.pnl is not None
    )
    if not circuit_breaker_active and cfg.max_drawdown_pct:
        max_drawdown = cfg.capital * cfg.max_drawdown_pct
        circuit_breaker_active = all_closed_pnl < 0 and abs(all_closed_pnl) >= max_drawdown

    return {
        "open_trades": len(open_trades),
        "circuit_breaker_active": circuit_breaker_active,
        "daily_pnl": round(daily_pnl, 2),
        "max_daily_loss": round(max_daily_loss, 2),
        "all_time_pnl": round(all_closed_pnl, 2),
    }

from dataclasses import asdict
from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, RiskDep, TradeDep
from app.domain.models.trade import TradeStatus

router = APIRouter(prefix="/risk", tags=["risk-engine"])


class ValidateRequest(BaseModel):
    signal: str
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    quantity: int = Field(ge=1)


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


@router.get("/status")
async def get_risk_status(
    current_user: CurrentUser,
    repo: TradeDep,
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

    return {
        "open_trades": len(open_trades),
        "circuit_breaker_active": False,  # Phase 3: wire to real drawdown tracking
        "daily_pnl": round(daily_pnl, 2),
    }

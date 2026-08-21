"""MTS Strategy Dashboard: a combined My-Trading-Dashboard-style heat map +
signals table across just Gold Guinea, Silver100, and NG Mini's MTS Strategy
engines. See app/services/mcx_strategy_dashboard_service.py."""

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/mcx/strategy-dashboard", tags=["mcx"])


@router.get("")
async def strategy_dashboard(
    current_user: CurrentUser, capital: float = 100_000.0, account_risk_pct: float = 0.5
) -> dict:
    """Live-scored (not cache-backed -- only 3 contracts, see service
    docstring) ranked view across Gold Guinea, Silver100, and NG Mini."""
    from app.services.mcx_service import McxNotConnectedError
    from app.services.mcx_strategy_dashboard_service import get_strategy_dashboard

    try:
        return await get_strategy_dashboard(str(current_user.id), capital, account_risk_pct)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Strategy dashboard unavailable: {exc}",
        ) from exc


@router.get("/signals")
async def strategy_dashboard_signals(current_user: CurrentUser, limit: int = 200) -> dict:
    """Combined MTS Strategy signal history (Gold Guinea + Silver100 + NG
    Mini) plus a per-contract accuracy readout."""
    from app.services.mcx_strategy_dashboard_service import get_strategy_dashboard_signals

    return await get_strategy_dashboard_signals(str(current_user.id), limit)

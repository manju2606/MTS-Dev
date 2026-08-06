"""Stock Analysis — search any symbol, get its chart + multi-timeframe
forecast. AI signal (BUY/SELL/HOLD + entry/stop/target) comes from the
existing POST /ai/analyze/{symbol}; day/week/month ML forecast from the
existing GET /forecast/{symbol}. This module only adds the chart's own
short-horizon forecast for an arbitrary symbol.

See app/services/golden_egg_intraday_prediction_service.py for that engine
-- it was written symbol-agnostic for Golden Egg's picked stock, so it's
reused here unchanged rather than duplicated. Predictions/accuracy for a
given symbol are shared between this page and Golden Egg's own chart
(same underlying Mongo key), which is intentional: they're the same real
forecast for that symbol regardless of which page asked for it.
"""

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/stock-analysis", tags=["stock-analysis"])


def _norm(symbol: str) -> str:
    s = symbol.upper().strip()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


@router.get("/predict")
async def predict(
    _: CurrentUser,
    symbol: str = Query(...),
    period: str = Query(default="1h"),
) -> dict:
    """Chart forecast (5m/15m/30m/1h/2h/4h/1D/1W/1M) plus day/week/month
    high-low for any symbol."""
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.golden_egg_intraday_prediction_service import get_prediction

    sym = _norm(symbol)
    try:
        return await get_prediction(sym, period, McxPredictionRepository())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Prediction unavailable: {exc}") from exc

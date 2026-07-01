from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/forecast", tags=["forecast"])


def _norm(symbol: str) -> str:
    s = symbol.upper().strip()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


def _serialise(result: object) -> dict:
    from app.domain.models.forecast import ForecastResult
    r: ForecastResult = result  # type: ignore[assignment]
    d = asdict(r)
    d["id"] = str(d["id"])
    d["generated_at"] = r.generated_at.isoformat()
    return d


@router.get("/{symbol}/history")
async def get_forecast_history(
    symbol: str,
    current_user: CurrentUser,
    horizon: str | None = Query(default=None),
    limit: int = Query(default=30, le=100),
) -> list[dict]:
    from app.infra.db.repositories.forecast_repo import ForecastRepository
    sym = _norm(symbol)
    repo = ForecastRepository()
    return await repo.list_history(sym, horizon=horizon, limit=limit)


@router.get("/{symbol}")
async def get_forecast(
    symbol: str,
    current_user: CurrentUser,
) -> dict:
    from app.services.forecast_service import generate_forecast
    sym = _norm(symbol)
    try:
        result = await generate_forecast(sym)
        return _serialise(result)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forecast failed: {exc}") from exc

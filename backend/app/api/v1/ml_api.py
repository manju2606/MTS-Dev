"""ML prediction endpoints — RandomForest trained on-the-fly from yfinance data."""

import asyncio
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.infra.ml.predictor import predict

router = APIRouter(prefix="/ml", tags=["ml-predictions"])


def _norm(symbol: str) -> str:
    s = symbol.upper()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


def _serialize(pred) -> dict:  # type: ignore[no-untyped-def]
    return asdict(pred)


@router.get("/predict/{symbol}")
async def predict_symbol(symbol: str, current_user: CurrentUser) -> dict:
    sym = _norm(symbol)
    try:
        result = await predict(sym)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc
    return _serialize(result)


class BatchPredictRequest(BaseModel):
    symbols: list[str]


@router.post("/predict/batch")
async def predict_batch(body: BatchPredictRequest, current_user: CurrentUser) -> list[dict]:
    async def _one(raw: str) -> dict | None:
        try:
            return _serialize(await predict(_norm(raw)))
        except Exception:
            return None

    results = await asyncio.gather(*[_one(s) for s in body.symbols])
    return [r for r in results if r is not None]

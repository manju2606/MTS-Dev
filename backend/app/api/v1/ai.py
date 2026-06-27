import asyncio
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import AIDep, CurrentUser, MarketDataDep
from app.infra.ai.technical import fetch_indicators

router = APIRouter(prefix="/ai", tags=["ai-engine"])


def _norm(symbol: str) -> str:
    s = symbol.upper()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


def _serialize(rec: object) -> dict:
    from app.domain.models.recommendation import AIRecommendation
    r: AIRecommendation = rec  # type: ignore[assignment]
    d = asdict(r)
    d["id"] = str(d["id"])
    d["generated_at"] = r.generated_at.isoformat()
    return d


class BatchRequest(BaseModel):
    symbols: list[str]


@router.post("/analyze/{symbol}")
async def analyze_symbol(
    symbol: str,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
) -> dict:
    sym = _norm(symbol)
    try:
        quote, ta = await asyncio.gather(
            market_data.get_quote(sym),
            fetch_indicators(sym),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    rec = await ai_client.analyze(symbol=sym, quote=quote, ta=ta)
    return _serialize(rec)


@router.post("/analyze/batch")
async def analyze_batch(
    body: BatchRequest,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
) -> list[dict]:
    async def _one(raw_symbol: str) -> dict | None:
        sym = _norm(raw_symbol)
        try:
            quote, ta = await asyncio.gather(
                market_data.get_quote(sym),
                fetch_indicators(sym),
            )
            rec = await ai_client.analyze(symbol=sym, quote=quote, ta=ta)
            return _serialize(rec)
        except Exception:
            return None

    results = await asyncio.gather(*[_one(s) for s in body.symbols])
    return [r for r in results if r is not None]

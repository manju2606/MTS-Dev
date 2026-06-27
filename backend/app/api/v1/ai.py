import asyncio
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import AIDep, CurrentUser, MarketDataDep
from app.infra.ai.technical import fetch_indicators

router = APIRouter(prefix="/ai", tags=["ai-engine"])

_NO_KEY = "ANTHROPIC_API_KEY not configured — set it in backend/.env to enable the AI Engine"


def _norm(symbol: str) -> str:
    s = symbol.upper()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


def _require_ai(client: AIDep):  # type: ignore[return]
    if client is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NO_KEY)
    return client


class BatchRequest(BaseModel):
    symbols: list[str]


@router.post("/analyze/{symbol}")
async def analyze_symbol(
    symbol: str,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
) -> dict:
    client = _require_ai(ai_client)
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

    rec = await client.analyze(symbol=quote.symbol, quote=quote, ta=ta)
    d = asdict(rec)
    d["id"] = str(d["id"])
    d["generated_at"] = rec.generated_at.isoformat()
    return d


@router.post("/analyze/batch")
async def analyze_batch(
    body: BatchRequest,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
) -> list[dict]:
    client = _require_ai(ai_client)

    async def _one(raw_symbol: str) -> dict | None:
        sym = _norm(raw_symbol)
        try:
            quote, ta = await asyncio.gather(
                market_data.get_quote(sym),
                fetch_indicators(sym),
            )
            rec = await client.analyze(symbol=sym, quote=quote, ta=ta)
            d = asdict(rec)
            d["id"] = str(d["id"])
            d["generated_at"] = rec.generated_at.isoformat()
            return d
        except Exception:
            return None

    results = await asyncio.gather(*[_one(s) for s in body.symbols])
    return [r for r in results if r is not None]

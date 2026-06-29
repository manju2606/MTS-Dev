import asyncio
import contextlib
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.deps import AIDep, AISignalDep, CurrentUser, MarketDataDep, require_role
from app.core.limiter import limiter
from app.domain.models.ai_signal import AISignal
from app.domain.models.user import UserRole
from app.infra.ai.technical import fetch_indicators

router = APIRouter(prefix="/ai", tags=["ai-engine"])

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))


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


async def _save_signal(signal_repo: AISignalDep, user_id, rec: object) -> None:
    from app.domain.models.recommendation import AIRecommendation
    r: AIRecommendation = rec  # type: ignore[assignment]
    sig = AISignal(
        user_id=user_id,
        symbol=r.symbol,
        signal=r.signal,
        confidence=r.confidence,
        entry_price=r.entry_price,
        stop_loss=r.stop_loss,
        target=r.target,
        risk_reward_ratio=r.risk_reward_ratio,
        holding_period=r.holding_period,
        explanation=r.explanation,
        engine=r.engine,
    )
    await signal_repo.save(sig)


class BatchRequest(BaseModel):
    symbols: list[str]


# batch must be registered BEFORE /{symbol} — FastAPI matches routes in order
@router.post("/analyze/batch", dependencies=[_trader_or_admin])
@limiter.limit("10/minute")
async def analyze_batch(
    request: Request,
    body: BatchRequest,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
    signal_repo: AISignalDep,
) -> list[dict]:
    async def _one(raw_symbol: str) -> dict | None:
        sym = _norm(raw_symbol)
        try:
            quote, ta = await asyncio.gather(
                market_data.get_quote(sym),
                fetch_indicators(sym),
            )
            rec = await ai_client.analyze(symbol=sym, quote=quote, ta=ta)
        except Exception:
            return None
        with contextlib.suppress(Exception):
            await _save_signal(signal_repo, current_user.id, rec)
        return _serialize(rec)

    results = await asyncio.gather(*[_one(s) for s in body.symbols])
    return [r for r in results if r is not None]


@router.post("/analyze/{symbol}", dependencies=[_trader_or_admin])
@limiter.limit("10/minute")
async def analyze_symbol(
    request: Request,
    symbol: str,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
    signal_repo: AISignalDep,
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
    await _save_signal(signal_repo, current_user.id, rec)
    return _serialize(rec)


@router.get("/history")
async def signal_history(
    current_user: CurrentUser,
    signal_repo: AISignalDep,
    symbol: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
) -> list[dict]:
    signals = await signal_repo.list_by_user(
        current_user.id, symbol=symbol, limit=limit
    )
    return [
        {
            "id": str(s.id),
            "symbol": s.symbol,
            "signal": s.signal,
            "confidence": s.confidence,
            "entry_price": s.entry_price,
            "stop_loss": s.stop_loss,
            "target": s.target,
            "risk_reward_ratio": s.risk_reward_ratio,
            "holding_period": s.holding_period,
            "explanation": s.explanation,
            "engine": s.engine,
            "created_at": s.created_at.isoformat(),
        }
        for s in signals
    ]

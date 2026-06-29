import asyncio
import contextlib
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.deps import (
    AIDep,
    AISignalDep,
    CurrentUser,
    MarketDataDep,
    check_ai_usage,
    require_role,
)
from app.core.limiter import limiter
from app.domain.models.ai_signal import AISignal
from app.domain.models.user import UserRole
from app.infra.ai.technical import fetch_indicators

router = APIRouter(prefix="/ai", tags=["ai-engine"])

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))
_usage_gate = Depends(check_ai_usage)


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


@router.post(
    "/ensemble/{symbol}",
    dependencies=[_trader_or_admin, _usage_gate],
)
@limiter.limit("5/minute")
async def ensemble_signal(
    request: Request,
    symbol: str,
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
    signal_repo: AISignalDep,
) -> dict:
    """Combine Local AI + ML + Claude (if configured) into a single consensus signal."""
    from app.infra.ml.predictor import predict

    sym = _norm(symbol)
    try:
        quote, ta = await asyncio.gather(
            market_data.get_quote(sym),
            fetch_indicators(sym),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    # Run local AI and ML concurrently; Claude is optional (slow + costly)
    local_task = asyncio.create_task(ai_client.analyze(symbol=sym, quote=quote, ta=ta))
    ml_task = asyncio.create_task(predict(sym))
    local_rec, ml_pred = await asyncio.gather(local_task, ml_task, return_exceptions=True)

    engines: dict[str, object] = {}

    if isinstance(local_rec, Exception):
        local_rec = None
    else:
        engines["local"] = _serialize(local_rec)

    if isinstance(ml_pred, Exception):
        ml_pred = None
    else:
        engines["ml"] = {
            "prediction": ml_pred.prediction,
            "probability": ml_pred.probability,
            "accuracy_cv": ml_pred.accuracy_cv,
            "top_features": ml_pred.feature_importances,
        }

    # Build consensus from available engines
    votes: list[tuple[float, float]] = []  # (signal_score, confidence)
    if local_rec is not None:
        score = 1.0 if local_rec.signal == "BUY" else (-1.0 if local_rec.signal == "SELL" else 0.0)
        votes.append((score, local_rec.confidence))
    if ml_pred is not None:
        score = 1.0 if ml_pred.prediction == "UP" else -1.0
        votes.append((score, ml_pred.probability))

    if not votes:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="All engines failed to produce a signal.",
        )

    avg_score = sum(s for s, _ in votes) / len(votes)
    avg_conf = sum(c for _, c in votes) / len(votes)
    consensus_signal = "BUY" if avg_score > 0.15 else ("SELL" if avg_score < -0.15 else "HOLD")

    # Derive consensus price levels from local engine (most detailed), fall back to quote
    entry = local_rec.entry_price if local_rec else quote.price
    stop = local_rec.stop_loss if local_rec else round(quote.price * 0.95, 2)
    target = local_rec.target if local_rec else round(quote.price * 1.10, 2)
    rrr = round((target - entry) / (entry - stop), 2) if entry > stop else 0.0
    holding = local_rec.holding_period if local_rec else "3–5 days"

    engine_names = list(engines.keys())
    explanation = (
        f"Consensus: {len(votes)}/{len(engine_names)} engine(s) → {consensus_signal}. "
        f"Engines: {', '.join(engine_names)}. "
        f"Avg confidence: {avg_conf:.2f}."
    )

    consensus = {
        "signal": consensus_signal,
        "confidence": round(avg_conf, 3),
        "entry_price": entry,
        "stop_loss": stop,
        "target": target,
        "risk_reward_ratio": rrr,
        "holding_period": holding,
        "explanation": explanation,
    }

    with contextlib.suppress(Exception):
        from app.domain.models.ai_signal import AISignal as Sig
        await signal_repo.save(
            Sig(
                user_id=current_user.id,
                symbol=sym,
                signal=consensus_signal,
                confidence=round(avg_conf, 3),
                entry_price=entry,
                stop_loss=stop,
                target=target,
                risk_reward_ratio=rrr,
                holding_period=holding,
                explanation=explanation,
                engine="ensemble",
            )
        )

    return {"symbol": sym, "consensus": consensus, "engines": engines}


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

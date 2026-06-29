import asyncio
import contextlib
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.deps import (
    AIDep,
    AISignalDep,
    ClaudeDep,
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
    claude_client: ClaudeDep,
    signal_repo: AISignalDep,
) -> dict:
    """Combine Local AI + ML + Claude (if API key set) into a single consensus signal."""
    from app.infra.ai.local_engine import LocalAIClient
    from app.infra.ml.predictor import predict

    sym = _norm(symbol)
    try:
        quote, ta = await asyncio.gather(
            market_data.get_quote(sym),
            fetch_indicators(sym),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    # Always run Local and ML; Claude only when configured.
    tasks = [
        asyncio.create_task(LocalAIClient().analyze(symbol=sym, quote=quote, ta=ta)),
        asyncio.create_task(predict(sym)),
    ]
    if claude_client:
        tasks.append(asyncio.create_task(claude_client.analyze(symbol=sym, quote=quote, ta=ta)))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    local_result = results[0]
    ml_result = results[1]
    claude_result = results[2] if claude_client else None

    engines: dict[str, object] = {}
    votes: list[tuple[float, float]] = []  # (directional score, confidence)

    if not isinstance(local_result, Exception):
        score = 1.0 if local_result.signal == "BUY" else (-1.0 if local_result.signal == "SELL" else 0.0)
        votes.append((score, local_result.confidence))
        engines["local"] = _serialize(local_result)
    else:
        local_result = None

    if not isinstance(ml_result, Exception):
        score = 1.0 if ml_result.prediction == "UP" else -1.0
        votes.append((score, ml_result.probability))
        engines["ml"] = {
            "prediction": ml_result.prediction,
            "probability": ml_result.probability,
            "accuracy_cv": ml_result.accuracy_cv,
            "top_features": ml_result.feature_importances,
        }
    else:
        ml_result = None

    if claude_result is not None and not isinstance(claude_result, Exception):
        score = 1.0 if claude_result.signal == "BUY" else (-1.0 if claude_result.signal == "SELL" else 0.0)
        votes.append((score, claude_result.confidence))
        engines["claude"] = _serialize(claude_result)
    else:
        claude_result = None

    if not votes:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="All engines failed to produce a signal.",
        )

    avg_score = sum(s for s, _ in votes) / len(votes)
    avg_conf = sum(c for _, c in votes) / len(votes)
    consensus_signal = "BUY" if avg_score > 0.15 else ("SELL" if avg_score < -0.15 else "HOLD")

    # Price levels: prefer Claude (has narrative context), then local, then raw quote
    price_source = claude_result or local_result
    entry = price_source.entry_price if price_source else quote.price
    stop = price_source.stop_loss if price_source else round(quote.price * 0.95, 2)
    target = price_source.target if price_source else round(quote.price * 1.10, 2)
    risk = abs(entry - stop)
    rrr = round(abs(target - entry) / risk, 2) if risk > 0 else 0.0
    holding = price_source.holding_period if price_source else "3–5 days"

    engine_names = list(engines.keys())
    buy_count = sum(1 for s, _ in votes if s > 0)
    sell_count = sum(1 for s, _ in votes if s < 0)
    hold_count = len(votes) - buy_count - sell_count
    vote_summary = f"BUY×{buy_count}" if buy_count else ""
    if sell_count:
        vote_summary += (" " if vote_summary else "") + f"SELL×{sell_count}"
    if hold_count:
        vote_summary += (" " if vote_summary else "") + f"HOLD×{hold_count}"
    explanation = (
        f"{len(engine_names)} engine(s): {vote_summary} → {consensus_signal} "
        f"(avg confidence {avg_conf:.0%}). "
        f"Engines: {', '.join(engine_names)}."
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

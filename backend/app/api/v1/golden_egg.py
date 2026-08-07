"""Golden Egg — daily single-pick API routes.

See app/services/golden_egg_service.py for the 09:15 IST scan/email/persist
pipeline, and golden_egg_intraday_prediction_service.py for the chart's own
multi-timeframe forecast (day/week/month-scale ML forecasts come from the
existing /forecast/{symbol} routes instead -- see today()'s note below).
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/golden-egg", tags=["golden-egg"])

_admin_only = Depends(require_role(UserRole.ADMIN))


async def _fetch_ltp_map(symbols: list[str]) -> dict[str, float]:
    """Batch-fetch live prices for a list of NSE/BSE symbols."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    unique = sorted({s for s in symbols if s})
    if not unique:
        return {}
    client = YFinanceClient()
    results = await asyncio.gather(
        *[client.get_quote(sym) for sym in unique], return_exceptions=True
    )
    return {
        sym: r.price
        for sym, r in zip(unique, results, strict=True)
        if not isinstance(r, Exception)
    }


def _attach_pnl(pick: dict, ltp: float | None) -> None:
    pick["ltp"] = ltp
    entry = pick.get("entry_price")
    if ltp is not None and entry:
        pick["pnl_amount"] = round(ltp - entry, 2)
        pick["pnl_pct"] = round((ltp - entry) / entry * 100, 2)
    else:
        pick["pnl_amount"] = None
        pick["pnl_pct"] = None


async def _attach_pnl_to_doc(doc: dict) -> None:
    pick = doc.get("pick")
    if not pick or not pick.get("symbol"):
        return
    ltp_map = await _fetch_ltp_map([pick["symbol"]])
    _attach_pnl(pick, ltp_map.get(pick["symbol"]))


async def _attach_pnl_to_docs(docs: list[dict]) -> None:
    symbols = [d["pick"]["symbol"] for d in docs if d.get("pick") and d["pick"].get("symbol")]
    ltp_map = await _fetch_ltp_map(symbols)
    for d in docs:
        pick = d.get("pick")
        if pick and pick.get("symbol"):
            _attach_pnl(pick, ltp_map.get(pick["symbol"]))


@router.get("/today")
async def get_today(_: CurrentUser) -> dict:
    """Most recent Golden Egg pick. Frontend also calls
    GET /forecast/{symbol} and GET /forecast/{symbol}/history with this
    pick's symbol for the day/week/month predictions -- those are the
    existing ML-ensemble forecast, reused as-is rather than duplicated
    here."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    doc = await repo.get_latest()
    if doc is None:
        raise HTTPException(status_code=404, detail="No Golden Egg pick yet. Run a scan first.")
    await _attach_pnl_to_doc(doc)
    return doc


@router.get("/history")
async def get_history(_: CurrentUser, limit: int = Query(default=30, ge=1, le=100)) -> list[dict]:
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    docs = await repo.get_history(limit=limit)
    await _attach_pnl_to_docs(docs)
    return docs


@router.get("/history/{date_str}")
async def get_by_date(date_str: str, _: CurrentUser) -> dict:
    """Most recent run for `date_str` -- kept for backward compat. A day can
    hold several runs now (see golden_egg_repo.py), so History table rows
    link to GET /pick/{id} below instead, which identifies one specific run
    rather than just "whatever's latest for this date"."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    doc = await repo.get_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No Golden Egg pick for date {date_str}")
    await _attach_pnl_to_doc(doc)
    return doc


@router.get("/pick/{pick_id}")
async def get_pick_by_id(pick_id: str, _: CurrentUser) -> dict:
    """One specific historical run by its own id -- what each History table
    row links to."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    doc = await repo.get_by_id(pick_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No Golden Egg pick found for id {pick_id}")
    await _attach_pnl_to_doc(doc)
    return doc


@router.post("/scan", dependencies=[_admin_only])
async def trigger_scan(_: CurrentUser) -> dict:
    """Manually trigger today's Golden Egg pick + email now (admin only)."""
    from app.services.golden_egg_service import send_golden_egg_email

    pick = await send_golden_egg_email()
    if pick is None:
        return {"pick": None, "message": "No candidate cleared the scanner's filters today."}
    import dataclasses

    doc = {"pick": dataclasses.asdict(pick)}
    await _attach_pnl_to_doc(doc)
    return doc


@router.get("/predict")
async def predict(
    _: CurrentUser,
    period: str = Query(default="1h"),
    id: str | None = Query(default=None),
) -> dict:
    """Chart forecast for a pick's symbol at the given timeframe
    (5m/15m/30m/1h/2h/4h/1D/1W/1M) -- today's latest pick by default, or a
    specific historical run via `id` (History table row links pass this).
    See golden_egg_intraday_prediction_service.py. 409 if that pick has no
    symbol to forecast."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.golden_egg_intraday_prediction_service import get_prediction

    egg_repo = GoldenEggRepository()
    doc = await egg_repo.get_by_id(id) if id else await egg_repo.get_latest()
    if doc is None or not doc.get("pick"):
        raise HTTPException(status_code=409, detail="No Golden Egg pick to forecast.")

    symbol = doc["pick"]["symbol"]
    try:
        return await get_prediction(symbol, period, McxPredictionRepository())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Prediction unavailable: {exc}") from exc

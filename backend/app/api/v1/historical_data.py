"""Historical OHLCV download & browse API — downloads via the same
connected Zerodha session as the MCX pages (official Kite Connect API,
needs the account's Historical Data subscription; see
historical_data_service.download_batch_official), persists to Mongo, and
serves it back out for charts/backtesting to consume."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.infra.db.repositories.historical_candle_repo import HistoricalCandleRepository
from app.services import historical_data_service

router = APIRouter(prefix="/historical-data", tags=["historical-data"])


class DownloadRequest(BaseModel):
    symbols: list[str]
    exchange: str = "NSE"
    interval: str = "day"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    include_oi: bool = False


@router.post("/download")
async def download(body: DownloadRequest, current_user: CurrentUser) -> dict:
    if not body.symbols:
        raise HTTPException(status_code=422, detail="symbols must not be empty")

    try:
        from_dt = datetime.strptime(body.from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(body.to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD") from exc
    if from_dt >= to_dt:
        raise HTTPException(status_code=422, detail="from_date must be before to_date")

    repo = HistoricalCandleRepository()
    try:
        results = await historical_data_service.download_batch_official(
            user_id=str(current_user.id),
            symbols=[s.strip().upper() for s in body.symbols if s.strip()],
            exchange=body.exchange.upper(),
            interval=body.interval,
            from_dt=from_dt,
            to_dt=to_dt,
            include_oi=body.include_oi,
            repo=repo,
        )
    except historical_data_service.NotConnectedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"results": results}


@router.get("/candles")
async def get_candles(
    _: CurrentUser,
    symbol: str = Query(...),
    exchange: str = Query(default="NSE"),
    interval: str = Query(default="day"),
    from_date: str = Query(...),
    to_date: str = Query(...),
) -> list[dict]:
    try:
        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD") from exc

    repo = HistoricalCandleRepository()
    candles = await repo.get_range(symbol, exchange, interval, from_dt, to_dt)
    return [
        {
            "time": c.time.isoformat(),
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
            "open_interest": c.open_interest,
        }
        for c in candles
    ]


@router.get("/mcx-contracts")
async def list_mcx_contracts(_: CurrentUser) -> list[dict]:
    """MCX contract-family options for the symbol picker (e.g. "NG" ->
    "Natural Gas") -- these resolve to today's actual front-month
    tradingsymbol at download time, see resolve_mcx_instrument()."""
    return historical_data_service.list_mcx_contracts()


@router.get("/symbols")
async def list_downloaded_symbols(_: CurrentUser) -> list[dict]:
    """What's already been downloaded, for a browse view. MCX rows get a
    `friendly_label` (e.g. "Natural Gas Mini") since their `symbol` is the
    resolved literal contract code (e.g. "NATGASMINI26JULFUT"), which rolls
    to a different string every month and isn't recognizable on its own."""
    repo = HistoricalCandleRepository()
    rows = await repo.list_downloaded_symbols()
    return [
        {
            **row,
            "from_time": row["from_time"].isoformat(),
            "to_time": row["to_time"].isoformat(),
            "friendly_label": (
                historical_data_service.friendly_mcx_label(row["symbol"])
                if row["exchange"] == "MCX"
                else None
            ),
        }
        for row in rows
    ]


@router.delete("/symbols")
async def delete_downloaded_series(
    _: CurrentUser,
    symbol: str = Query(...),
    exchange: str = Query(...),
    interval: str = Query(...),
) -> dict:
    """Deletes every stored candle for one (symbol, exchange, interval) --
    the whole downloaded series, not a date-range subset."""
    repo = HistoricalCandleRepository()
    deleted = await repo.delete_series(symbol, exchange, interval)
    return {"deleted": deleted}

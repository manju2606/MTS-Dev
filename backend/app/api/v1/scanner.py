import asyncio
import math
from dataclasses import asdict
from uuid import UUID

import yfinance as yf
from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, MarketDataDep, WatchlistDep
from app.core.limiter import limiter
from app.domain.models.watchlist import WatchlistItem
from app.infra.scanner.universe import SECTORS

_SYMBOL_SECTOR: dict[str, str] = {
    sym: sector for sector, syms in SECTORS.items() for sym in syms
}

router = APIRouter(prefix="/scanner", tags=["scanner"])

_DEFAULT_SYMBOLS = [
    "RELIANCE.NS",
    "TCS.NS",
    "INFY.NS",
    "HDFCBANK.NS",
    "ICICIBANK.NS",
    "HINDUNILVR.NS",
    "SBIN.NS",
    "BAJFINANCE.NS",
    "ITC.NS",
    "WIPRO.NS",
]


def _normalise(symbol: str) -> str:
    upper = symbol.upper()
    return upper if (upper.endswith(".NS") or upper.endswith(".BO")) else f"{upper}.NS"


class WatchlistCreateRequest(BaseModel):
    name: str


class WatchlistRenameRequest(BaseModel):
    name: str


class WatchlistAddItemRequest(BaseModel):
    symbol: str


class WatchlistAddRequest(BaseModel):
    symbol: str


_PERIOD_INTERVAL: dict[str, tuple[str, str]] = {
    "1W": ("5d", "1h"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "6M": ("6mo", "1d"),
    "1Y": ("1y", "1d"),
}


def _safe_f(v: object) -> float:
    try:
        f = float(v)  # type: ignore[arg-type]
        return 0.0 if math.isnan(f) else f
    except (TypeError, ValueError):
        return 0.0


def _fetch_history_sync(symbol: str, period: str, interval: str) -> list[dict]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval=interval, auto_adjust=True)
    if hist.empty:
        return []
    out = []
    for ts, row in hist.iterrows():
        o = _safe_f(row.get("Open"))
        h = _safe_f(row.get("High"))
        lo = _safe_f(row.get("Low"))
        c = _safe_f(row.get("Close"))
        v = int(_safe_f(row.get("Volume")))
        if o == 0 or c == 0:
            continue
        out.append({
            "time": int(ts.timestamp()),
            "open": round(o, 2),
            "high": round(h, 2),
            "low": round(lo, 2),
            "close": round(c, 2),
            "volume": v,
        })
    return out


# ── Market data ───────────────────────────────────────────────────────────────

@router.get("/history/{symbol}")
async def get_history(
    symbol: str,
    current_user: CurrentUser,
    period: str = Query(default="1M", pattern="^(1W|1M|3M|6M|1Y)$"),
) -> list[dict]:
    norm = symbol.upper()
    if not (norm.endswith(".NS") or norm.endswith(".BO")):
        norm = f"{norm}.NS"
    yf_period, yf_interval = _PERIOD_INTERVAL.get(period, ("1mo", "1d"))
    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(None, _fetch_history_sync, norm, yf_period, yf_interval)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to fetch history for '{norm}'",
        ) from exc
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No history available for '{norm}'",
        )
    return data


@router.get("/quotes/{symbol}")
@limiter.limit("30/minute")
async def get_quote(
    request: Request, symbol: str, current_user: CurrentUser, market_data: MarketDataDep
) -> dict:
    try:
        quote = await market_data.get_quote(symbol)
        return asdict(quote)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


# ── Watchlist management (multi-watchlist) ────────────────────────────────────

@router.get("/watchlists")
async def list_watchlists(current_user: CurrentUser, repo: WatchlistDep) -> list[dict]:
    wls = await repo.list_watchlists(current_user.id)
    return [asdict(wl) for wl in wls]


@router.post("/watchlists", status_code=status.HTTP_201_CREATED)
async def create_watchlist(
    body: WatchlistCreateRequest, current_user: CurrentUser, repo: WatchlistDep
) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name is required"
        )
    try:
        wl = await repo.create_watchlist(current_user.id, name)
        return asdict(wl)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A watchlist named '{name}' already exists",
        ) from exc


@router.patch("/watchlists/{watchlist_id}")
async def rename_watchlist(
    watchlist_id: UUID,
    body: WatchlistRenameRequest,
    current_user: CurrentUser,
    repo: WatchlistDep,
) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name is required"
        )
    try:
        wl = await repo.rename_watchlist(watchlist_id, current_user.id, name)
        return asdict(wl)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A watchlist named '{name}' already exists",
        ) from exc


@router.delete("/watchlists/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist(
    watchlist_id: UUID, current_user: CurrentUser, repo: WatchlistDep
) -> None:
    deleted = await repo.delete_watchlist(watchlist_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")


@router.get("/watchlists/{watchlist_id}/items")
async def list_watchlist_items(
    watchlist_id: UUID, current_user: CurrentUser, repo: WatchlistDep
) -> list[dict]:
    wl = await repo.get_watchlist(watchlist_id, current_user.id)
    if not wl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    items = await repo.list_items(watchlist_id, current_user.id)
    return [asdict(item) for item in items]


@router.post("/watchlists/{watchlist_id}/items", status_code=status.HTTP_201_CREATED)
async def add_item_to_watchlist(
    watchlist_id: UUID,
    body: WatchlistAddItemRequest,
    current_user: CurrentUser,
    repo: WatchlistDep,
    market_data: MarketDataDep,
) -> dict:
    wl = await repo.get_watchlist(watchlist_id, current_user.id)
    if not wl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")

    try:
        quote = await market_data.get_quote(body.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    item = WatchlistItem(
        user_id=current_user.id,
        watchlist_id=watchlist_id,
        symbol=quote.symbol,
        exchange=quote.exchange,
    )
    try:
        saved = await repo.add_item(item)
        return asdict(saved)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{quote.symbol}' is already in this watchlist",
        ) from exc


@router.delete(
    "/watchlists/{watchlist_id}/items/{symbol}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_item_from_watchlist(
    watchlist_id: UUID,
    symbol: str,
    current_user: CurrentUser,
    repo: WatchlistDep,
) -> None:
    removed = await repo.remove_item(watchlist_id, current_user.id, _normalise(symbol))
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Symbol not in watchlist"
        )


@router.post("/watchlists/{watchlist_id}/seed-defaults")
async def seed_watchlist_defaults(
    watchlist_id: UUID,
    current_user: CurrentUser,
    repo: WatchlistDep,
    market_data: MarketDataDep,
) -> dict:
    wl = await repo.get_watchlist(watchlist_id, current_user.id)
    if not wl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")

    existing = {item.symbol for item in await repo.list_items(watchlist_id, current_user.id)}
    to_fetch = [s for s in _DEFAULT_SYMBOLS if s not in existing]
    if not to_fetch:
        return {"added": 0}

    results = await asyncio.gather(
        *[market_data.get_quote(sym) for sym in to_fetch], return_exceptions=True
    )
    added = 0
    for r in results:
        if isinstance(r, Exception):
            continue
        item = WatchlistItem(
            user_id=current_user.id,
            watchlist_id=watchlist_id,
            symbol=r.symbol,
            exchange=r.exchange,
        )
        try:
            await repo.add_item(item)
            added += 1
        except IntegrityError:
            pass
    return {"added": added}


# ── Legacy endpoints (backward-compat) ───────────────────────────────────────

@router.get("/watchlist")
async def get_watchlist(current_user: CurrentUser, repo: WatchlistDep) -> list[dict]:
    items = await repo.list_by_user(current_user.id)
    return [asdict(item) for item in items]


@router.post("/watchlist", status_code=status.HTTP_201_CREATED)
async def add_to_watchlist(
    body: WatchlistAddRequest,
    current_user: CurrentUser,
    repo: WatchlistDep,
    market_data: MarketDataDep,
) -> dict:
    try:
        quote = await market_data.get_quote(body.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    # Route to first watchlist if one exists
    watchlists = await repo.list_watchlists(current_user.id)
    watchlist_id = watchlists[0].id if watchlists else None

    item = WatchlistItem(
        user_id=current_user.id,
        watchlist_id=watchlist_id,
        symbol=quote.symbol,
        exchange=quote.exchange,
    )
    try:
        saved = await repo.add(item)
        return asdict(saved)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{quote.symbol}' is already in your watchlist",
        ) from exc


@router.post("/watchlist/seed-defaults")
async def seed_default_watchlist(
    current_user: CurrentUser,
    repo: WatchlistDep,
    market_data: MarketDataDep,
) -> dict:
    # Ensure at least one watchlist exists
    watchlists = await repo.list_watchlists(current_user.id)
    if not watchlists:
        wl = await repo.create_watchlist(current_user.id, "My Watchlist")
    else:
        wl = watchlists[0]
    return await seed_watchlist_defaults(wl.id, current_user, repo, market_data)


@router.delete("/watchlist/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_watchlist(
    symbol: str, current_user: CurrentUser, repo: WatchlistDep
) -> None:
    normalised = _normalise(symbol)
    removed = await repo.remove(current_user.id, normalised)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{normalised}' not found in your watchlist",
        )


@router.get("/search")
async def search_stocks(
    q: str,
    current_user: CurrentUser,
) -> list[dict]:
    """Full-text search over NSE/BSE universe (symbol + name)."""
    query = q.strip().upper()
    if len(query) < 2:
        return []
    results = []
    for sym, sector in _SYMBOL_SECTOR.items():
        name = sym.replace(".NS", "").replace(".BO", "")
        if query in name or query in sym.upper():
            results.append({
                "symbol": sym,
                "name": name,
                "sector": sector,
                "exchange": "NSE" if sym.endswith(".NS") else "BSE",
            })
    return results[:12]

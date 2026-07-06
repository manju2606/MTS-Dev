import asyncio
import math
from dataclasses import asdict
from uuid import UUID

import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, MarketDataDep, WatchlistDep, require_role
from app.core.limiter import limiter
from app.domain.models.user import UserRole
from app.domain.models.watchlist import WatchlistItem
from app.infra.discovery.universe import NSE_UNIVERSE
from app.infra.market.stock_master import load_stock_master
from app.infra.scanner.market_scanner import SCAN_CATALOG, run_market_scan
from app.infra.scanner.universe import SECTORS

_SYMBOL_SECTOR: dict[str, str] = {
    sym: sector for sector, syms in SECTORS.items() for sym in syms
}
_SYMBOL_NAME: dict[str, str] = dict(NSE_UNIVERSE)

router = APIRouter(prefix="/scanner", tags=["scanner"])

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))


# ── Market scanner ────────────────────────────────────────────────────────────

@router.get("/scan-catalog")
async def scan_catalog(current_user: CurrentUser) -> list[dict]:
    """List all available scan types with metadata."""
    return SCAN_CATALOG


@router.get("/market-scan")
async def market_scan(
    current_user: CurrentUser,
    scan_type: str = Query(..., description="Scan ID from /scan-catalog"),
    limit: int = Query(default=25, ge=1, le=50),
) -> dict:
    """Run a market scan. First call per scan type takes 30–60 s while universe data is fetched;
    subsequent calls within 5 minutes are served from cache."""
    try:
        return await run_market_scan(scan_type, limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
    "1m": ("1d", "1m"),      # finest available — yfinance has no sub-minute data
    "1D": ("1d", "5m"),
    "5m": ("5d", "5m"),
    "5D": ("5d", "15m"),
    "15m": ("5d", "15m"),
    "30m": ("1mo", "30m"),
    "1W": ("5d", "1h"),
    "1h": ("3mo", "60m"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "6M": ("6mo", "1d"),
    "1Y": ("1y", "1d"),
}

# 45-min bars aren't a native yfinance interval (only 1/2/5/15/30/60/90-min and
# daily+ exist) — build them honestly by aggregating real 15-min bars 3-at-a-time,
# never merging across a day boundary.
_RESAMPLE_FROM: dict[str, tuple[str, str, int]] = {
    "45m": ("1mo", "15m", 3),
}


def _resample_bars(bars: list[dict], factor: int) -> list[dict]:
    from datetime import datetime, timezone

    def _merge(chunk: list[dict]) -> dict:
        return {
            "time": chunk[0]["time"],
            "open": chunk[0]["open"],
            "high": max(b["high"] for b in chunk),
            "low": min(b["low"] for b in chunk),
            "close": chunk[-1]["close"],
            "volume": sum(b["volume"] for b in chunk),
        }

    out: list[dict] = []
    chunk: list[dict] = []
    last_day = None
    for b in bars:
        day = datetime.fromtimestamp(b["time"], tz=timezone.utc).date()
        if last_day is not None and day != last_day and chunk:
            out.append(_merge(chunk))
            chunk = []
        chunk.append(b)
        last_day = day
        if len(chunk) == factor:
            out.append(_merge(chunk))
            chunk = []
    if chunk:
        out.append(_merge(chunk))
    return out


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
    period: str = Query(default="1M", pattern="^(1m|1D|5m|5D|15m|30m|45m|1W|1h|1M|3M|6M|1Y)$"),
) -> list[dict]:
    norm = symbol.upper()
    if not (norm.endswith(".NS") or norm.endswith(".BO")):
        norm = f"{norm}.NS"
    loop = asyncio.get_running_loop()
    try:
        if period in _RESAMPLE_FROM:
            yf_period, yf_interval, factor = _RESAMPLE_FROM[period]
            raw = await loop.run_in_executor(None, _fetch_history_sync, norm, yf_period, yf_interval)
            data = _resample_bars(raw, factor)
        else:
            yf_period, yf_interval = _PERIOD_INTERVAL.get(period, ("1mo", "1d"))
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


@router.get("/quote-detail/{symbol}")
@limiter.limit("30/minute")
async def get_quote_detail(request: Request, symbol: str, current_user: CurrentUser) -> dict:
    """Full enriched indicator set (RSI, MACD, SMA20/50/200, Bollinger Bands, trend,
    volume ratio, 52-week range, etc.) for a single arbitrary symbol — same data
    used by the watchlist quotes table, cached 60s."""
    from app.infra.market.enriched_quote import fetch_enriched_quotes

    sym = _normalise(symbol)
    results = await fetch_enriched_quotes([sym])
    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No data for {sym}")
    return results[0]


# ── Watchlist management (multi-watchlist) ────────────────────────────────────

@router.get("/watchlists")
async def list_watchlists(current_user: CurrentUser, repo: WatchlistDep) -> list[dict]:
    wls = await repo.list_watchlists(current_user.id)

    # Collect all symbols while the DB session is still open, then warm the
    # per-symbol quote cache in a background task so the first /quotes call
    # hits cache rather than blocking on a live yfinance download.
    all_symbols: list[str] = []
    for wl in wls:
        try:
            items = await repo.list_items(wl.id, current_user.id)
            all_symbols.extend(i.symbol for i in items)
        except Exception:
            pass
    unique = list(dict.fromkeys(all_symbols))  # deduplicate, preserve order
    if unique:
        asyncio.create_task(_prewarm_quote_cache(unique))

    return [asdict(wl) for wl in wls]


async def _prewarm_quote_cache(symbols: list[str]) -> None:
    """Background task: populate per-symbol quote cache for all watchlist symbols."""
    from app.infra.market.enriched_quote import fetch_enriched_quotes
    try:
        await fetch_enriched_quotes(symbols)
    except Exception:
        pass


@router.post("/watchlists", status_code=status.HTTP_201_CREATED, dependencies=[_trader_or_admin])
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


@router.patch("/watchlists/{watchlist_id}", dependencies=[_trader_or_admin])
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


@router.delete(
    "/watchlists/{watchlist_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[_trader_or_admin],
)
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


@router.get("/watchlists/{watchlist_id}/quotes")
async def get_watchlist_quotes(
    watchlist_id: UUID, current_user: CurrentUser, repo: WatchlistDep
) -> list[dict]:
    """Return enriched market data for all symbols in a watchlist (cached 60s)."""
    from app.infra.market.enriched_quote import fetch_enriched_quotes

    wl = await repo.get_watchlist(watchlist_id, current_user.id)
    if not wl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    items = await repo.list_items(watchlist_id, current_user.id)
    symbols = [item.symbol for item in items]
    if not symbols:
        return []
    return await fetch_enriched_quotes(symbols)


@router.post(
    "/watchlists/{watchlist_id}/items",
    status_code=status.HTTP_201_CREATED,
    dependencies=[_trader_or_admin],
)
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
    dependencies=[_trader_or_admin],
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


@router.post("/watchlists/{watchlist_id}/seed-defaults", dependencies=[_trader_or_admin])
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


@router.post("/watchlist", status_code=status.HTTP_201_CREATED, dependencies=[_trader_or_admin])
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


@router.post("/watchlist/seed-defaults", dependencies=[_trader_or_admin])
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


@router.delete(
    "/watchlist/{symbol}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[_trader_or_admin],
)
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
    """Full-text search over the NSE stock universe (symbol + company name).

    Backed by data/India_Stock_Master.csv (~2,700 NSE Equity/SME/ETF
    symbols from official NSE archive data). Falls back to the smaller
    hand-curated sector universe if that file isn't present in this
    checkout, so search degrades rather than breaking.
    """
    query = q.strip().upper()
    if len(query) < 2:
        return []
    query_compact = query.replace(" ", "")

    master = load_stock_master()
    if master:
        scored: list[tuple[int, str, dict]] = []
        for row in master:
            ticker = row["symbol"]
            name_upper = row["name"].upper()
            name_compact = name_upper.replace(" ", "")
            prev_ticker = row["previous_symbol"]
            prev_name_upper = row["previous_name"].upper()

            if ticker == query:
                score = 0
            elif ticker.startswith(query_compact):
                score = 1
            elif name_upper.startswith(query):
                score = 2
            elif query_compact in ticker:
                score = 3
            elif query in name_upper or query_compact in name_compact:
                score = 4
            elif prev_ticker == query or query in prev_name_upper:
                score = 5
            else:
                continue

            display_name = row["name"]
            if score == 5 and prev_name_upper:
                display_name = f"{display_name} (formerly {row['previous_name']})"

            scored.append((score, ticker, {
                "symbol": row["yahoo_symbol"],
                "name": display_name,
                "sector": row["sector"],
                "exchange": row["exchange"],
            }))
        scored.sort(key=lambda t: (t[0], t[1]))
        return [item for _, _, item in scored[:12]]

    results = []
    for sym, sector in _SYMBOL_SECTOR.items():
        ticker = sym.replace(".NS", "").replace(".BO", "")
        display_name = _SYMBOL_NAME.get(sym, ticker)
        name_upper = display_name.upper()
        if (
            query in name_upper
            or query in sym.upper()
            or query_compact in name_upper.replace(" ", "")
            or query_compact in ticker
        ):
            results.append({
                "symbol": sym,
                "name": display_name,
                "sector": sector,
                "exchange": "NSE" if sym.endswith(".NS") else "BSE",
            })
    return results[:12]

"""MCX Base & Precious Metals: live quotes and paper trading.

Sibling module to mcx_service.py (Natural Gas) -- same Kite-backed
front-month resolution and paper-trading pattern, covering the other MCX
commodity family instead. Deliberately NOT a generalization of
mcx_service.py's resolve_contract()/get_quote()/get_history() (which several
other NG services import directly) -- kept as a parallel, self-contained
module so nothing here can regress the already-stabilized NG feature.

Broker-session plumbing (get_zerodha_broker, McxNotConnectedError), the
shared Kite MCX instrument dump (_get_mcx_instruments), the Redis quote
cache (_cache_quote/_get_cached_quote, already namespaced per-contract so
"GOLD"/"COPPER"/etc. can't collide with "NG"/"NGMINI"), ist_now(), and
_trade_dict() are all commodity-agnostic and imported straight from
mcx_service.py rather than duplicated.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

import structlog

from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
from app.infra.brokers import session_store
from app.infra.brokers.zerodha import ZerodhaBroker
from app.services.mcx_service import (
    McxNotConnectedError,
    _cache_quote,
    _get_cached_quote,
    _get_mcx_instruments,
    _trade_dict,
    get_zerodha_broker,
    ist_now,
)

log = structlog.get_logger()

# Public contract code (used in URLs/UI) -> Kite instrument "name" field.
# Best-effort guesses pending verification against a real connected Kite
# session -- resolve_metal_contract() raises a clear, debuggable error
# listing every distinct MCX instrument name in Kite's dump if a mapping
# here turns out wrong, so a bad guess is immediately self-correcting
# rather than failing silently.
MCX_METALS_CONTRACTS: dict[str, str] = {
    "ALUMINIUM": "ALUMINIUM",
    "ALUMINI": "ALUMINI",
    "COPPER": "COPPER",
    "LEAD": "LEAD",
    "LEADMINI": "LEADMINI",
    "NICKEL": "NICKEL",
    "ZINC": "ZINC",
    "ZINCMINI": "ZINCMINI",
    "GOLD": "GOLD",
    "GOLDMINI": "GOLDM",
    "GOLDTEN": "GOLDTEN",
    "GOLDGUINEA": "GOLDGUINEA",
    "GOLDPETAL": "GOLDPETAL",
    "SILVER": "SILVER",
    "SILVERMINI": "SILVERM",
    "SILVERMICRO": "SILVERMIC",
    "SILVER100": "SILVER100",
}

# All 17 variants -- tracked by the background scheduler at the same
# cadence as NG's own contracts (confirmed acceptable Kite API load
# tradeoff). No specific-expiry ("_<MONTH>") support for v1, unlike NG --
# each code always resolves to its own front month.
TRACKED_MCX_METALS_CONTRACTS: list[str] = list(MCX_METALS_CONTRACTS.keys())


async def resolve_metal_contract(broker: ZerodhaBroker, contract: str = "GOLD") -> dict:
    """The current front-month MCX futures contract for `contract` (one of
    MCX_METALS_CONTRACTS' keys)."""
    kite_name = MCX_METALS_CONTRACTS.get(contract.upper())
    if kite_name is None:
        raise ValueError(
            f"Unknown MCX metals contract '{contract}' -- expected one of "
            f"{list(MCX_METALS_CONTRACTS)}"
        )

    instruments = await _get_mcx_instruments(broker)
    candidates = [
        i
        for i in instruments
        if str(i.get("name", "")).upper() == kite_name and i.get("instrument_type") == "FUT"
    ]
    if not candidates:
        all_names = sorted({str(i.get("name", "")) for i in instruments if i.get("name")})
        raise ValueError(
            f"No MCX futures found for '{kite_name}' (contract={contract}) -- the "
            f"MCX_METALS_CONTRACTS mapping for this code is likely wrong. All "
            f"instrument names in Kite's MCX dump: {all_names or 'none'}"
        )

    def _expiry(c: dict) -> date:
        exp = c["expiry"]
        return exp if isinstance(exp, date) else datetime.strptime(str(exp), "%Y-%m-%d").date()

    today = date.today()
    unexpired = sorted((c for c in candidates if _expiry(c) >= today), key=_expiry)
    return unexpired[0] if unexpired else sorted(candidates, key=_expiry)[-1]


async def _fetch_live_metal_quote(user_id: str, contract: str) -> dict:
    broker = await get_zerodha_broker(user_id)
    c = await resolve_metal_contract(broker, contract)
    tradingsymbol = c["tradingsymbol"]
    raw = await broker.get_raw_quote("MCX", tradingsymbol)

    ohlc = raw.get("ohlc", {}) or {}
    last_price = float(raw.get("last_price", 0.0))
    prev_close = float(ohlc.get("close", 0.0))
    change = round(last_price - prev_close, 2)
    change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0

    return {
        "contract": contract.upper(),
        "tradingsymbol": tradingsymbol,
        "name": MCX_METALS_CONTRACTS[contract.upper()],
        "expiry": str(c["expiry"]),
        "lot_size": int(c.get("lot_size", 1)),
        "tick_size": float(c.get("tick_size", 0.1)),
        "last_price": last_price,
        "open": float(ohlc.get("open", 0.0)),
        "high": float(ohlc.get("high", 0.0)),
        "low": float(ohlc.get("low", 0.0)),
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "volume": int(raw.get("volume", 0)),
        "oi": int(raw.get("oi", 0)),
        "oi_day_high": int(raw.get("oi_day_high", 0)),
        "oi_day_low": int(raw.get("oi_day_low", 0)),
    }


async def get_metal_quote(user_id: str, contract: str = "GOLD") -> dict:
    """Live MCX front-month metals quote: LTP, OHLC, volume, OI. Falls back
    to the last successfully fetched quote (marked stale=True) if Zerodha is
    unreachable right now, same fallback behavior as NG's get_quote()."""
    try:
        quote = await _fetch_live_metal_quote(user_id, contract)
        quote["stale"] = False
        await _cache_quote(user_id, contract, quote)
        return quote
    except Exception as exc:
        cached = await _get_cached_quote(user_id, contract)
        if cached is None:
            raise
        log.warning(
            "mcx_metals.quote.fallback_to_cache",
            user_id=user_id,
            contract=contract,
            error=str(exc),
        )
        cached["stale"] = True
        return cached


# period -> (Kite interval, lookback days) -- identical to NG's own map.
_HISTORY_PERIOD_MAP: dict[str, tuple[str, int]] = {
    "1m": ("minute", 5),
    "5m": ("5minute", 15),
    "15m": ("15minute", 30),
    "30m": ("15minute", 30),
    "45m": ("60minute", 90),
    "1h": ("60minute", 90),
    "1D": ("day", 365),
    "5D": ("day", 365),
    "1W": ("day", 365 * 2),
    "1M": ("day", 365 * 2),
    "3M": ("day", 365 * 3),
    "6M": ("day", 365 * 5),
    "1Y": ("day", 365 * 5),
}


async def get_metal_history(user_id: str, period: str, contract: str = "GOLD") -> list[dict]:
    """MCX OHLCV history for `contract`, in the same {time, open, high, low,
    close, volume} shape the shared PriceChart component expects."""
    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_metal_contract(broker, contract)
    interval, days = _HISTORY_PERIOD_MAP.get(period, ("day", 365))

    to_dt = ist_now()
    from_dt = to_dt - timedelta(days=days)
    candles = await broker.get_historical_candles(
        c_info["instrument_token"],
        interval,
        from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        to_dt.strftime("%Y-%m-%d %H:%M:%S"),
    )

    out = []
    for c in candles:
        ts = c["date"]
        out.append(
            {
                "time": int(ts.timestamp()),
                "open": round(float(c["open"]), 2),
                "high": round(float(c["high"]), 2),
                "low": round(float(c["low"]), 2),
                "close": round(float(c["close"]), 2),
                "volume": int(c.get("volume", 0)),
            }
        )
    return out


async def get_metal_range_stats(user_id: str, contract: str = "GOLD") -> dict:
    """Day/week/month high-low for the front-month contract -- same
    composition as NG's get_range_stats()."""
    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_metal_contract(broker, contract)
    quote = await get_metal_quote(user_id, contract)

    to_dt = ist_now()
    from_dt = to_dt - timedelta(days=40)
    candles = await broker.get_historical_candles(
        c_info["instrument_token"],
        "day",
        from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        to_dt.strftime("%Y-%m-%d %H:%M:%S"),
    )

    today = to_dt.date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    week_candles = [c for c in candles if c["date"].date() >= week_start]
    month_candles = [c for c in candles if c["date"].date() >= month_start]

    day_high = float(quote["high"])
    day_low = float(quote["low"])

    def _high(cs: list[dict]) -> float:
        highs = [float(c["high"]) for c in cs] + ([day_high] if day_high else [])
        return max(highs, default=day_high)

    def _low(cs: list[dict]) -> float:
        lows = [float(c["low"]) for c in cs if float(c["low"]) > 0] + ([day_low] if day_low else [])
        return min(lows, default=day_low)

    week_high = _high(week_candles)
    week_low = _low(week_candles)
    month_high = _high(month_candles)
    month_low = _low(month_candles)

    return {
        "contract": contract.upper(),
        "day_high": round(day_high, 2),
        "day_low": round(day_low, 2),
        "week_high": round(week_high, 2),
        "week_low": round(week_low, 2),
        "month_high": round(month_high, 2),
        "month_low": round(month_low, 2),
    }


async def _lot_size_for_metal_symbol(broker: ZerodhaBroker, symbol: str) -> int:
    """Resolve lot size from a trade's own stored tradingsymbol -- correct
    even if that contract has since rolled/expired. Falls back to 1 (not a
    guessed tonnage) if the symbol has rolled out of Kite's instrument dump
    entirely -- unlike NG/NGMINI, there's no reliable two-way fallback
    across 17 different metals' lot conventions to hardcode."""
    instruments = await _get_mcx_instruments(broker)
    for i in instruments:
        if i.get("tradingsymbol") == symbol:
            return int(i.get("lot_size", 1))
    return 1


async def place_metal_trade(
    user_id: str,
    repo,  # TradeRepository
    signal: TradeSignal,
    lots: int,
    stop_loss: float,
    target: float,
    limit_price: float | None = None,
    contract: str = "GOLD",
) -> dict:
    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_metal_contract(broker, contract)
    tradingsymbol = c_info["tradingsymbol"]
    lot_size = int(c_info.get("lot_size", 1))
    quantity = lots * lot_size

    if limit_price is not None:
        entry = limit_price
    else:
        raw = await broker.get_raw_quote("MCX", tradingsymbol)
        entry = float(raw.get("last_price", 0.0))

    if signal == TradeSignal.BUY:
        if stop_loss >= entry:
            raise ValueError(f"BUY stop_loss ({stop_loss}) must be below entry price ({entry})")
        if target <= entry:
            raise ValueError(f"BUY target ({target}) must be above entry price ({entry})")
    else:
        if stop_loss <= entry:
            raise ValueError(f"SELL stop_loss ({stop_loss}) must be above entry price ({entry})")
        if target >= entry:
            raise ValueError(f"SELL target ({target}) must be below entry price ({entry})")

    is_limit_order = limit_price is not None
    trade = Trade(
        user_id=UUID(user_id),
        symbol=tradingsymbol,
        exchange="MCX",
        signal=signal,
        entry_price=entry,
        stop_loss=stop_loss,
        target=target,
        quantity=quantity,
        mode=TradeMode.PAPER,
        status=TradeStatus.PENDING if is_limit_order else TradeStatus.OPEN,
        opened_at=None if is_limit_order else datetime.utcnow(),
    )
    saved = await repo.create(trade)
    log.info("mcx_metals.trade.placed", symbol=tradingsymbol, lots=lots, signal=signal)
    return _trade_dict(saved, lot_size)


async def list_metal_trades(
    user_id: str, repo, trade_status: TradeStatus | None = None
) -> list[dict]:
    broker = await session_store.get(user_id)
    trades = await repo.list_by_user(UUID(user_id), trade_status)
    metal_symbols = set(MCX_METALS_CONTRACTS.values())
    metals_trades = [
        t
        for t in trades
        if t.exchange == "MCX" and any(t.symbol.upper().startswith(n) for n in metal_symbols)
    ]

    async def _lot_size(t: Trade) -> int:
        if isinstance(broker, ZerodhaBroker):
            try:
                return await _lot_size_for_metal_symbol(broker, t.symbol)
            except Exception:
                pass
        return 1

    return [_trade_dict(t, await _lot_size(t)) for t in metals_trades]


async def close_metal_trade(
    user_id: str, repo, trade_id: UUID, exit_price: float | None = None
) -> dict:
    trade = await repo.get_by_id(trade_id)
    if not trade or str(trade.user_id) != user_id or trade.exchange != "MCX":
        raise LookupError("Trade not found")
    if trade.status != TradeStatus.OPEN:
        raise ValueError(f"Trade is already {trade.status}")

    broker = await get_zerodha_broker(user_id)
    if exit_price is not None:
        price = exit_price
    else:
        raw = await broker.get_raw_quote("MCX", trade.symbol)
        price = float(raw.get("last_price", 0.0))
    lot_size = await _lot_size_for_metal_symbol(broker, trade.symbol)

    trade.exit_price = price
    trade.closed_at = datetime.utcnow()
    trade.status = TradeStatus.CLOSED
    updated = await repo.update(trade)
    log.info("mcx_metals.trade.closed", symbol=trade.symbol, exit_price=price)
    return _trade_dict(updated, lot_size)


async def cancel_metal_trade(user_id: str, repo, trade_id: UUID) -> dict:
    """Cancel a PENDING (unfilled LIMIT) metals order before it triggers --
    same rationale as NG's cancel_ng_trade(): there's no fill-checking job
    for MCX limit orders, so this is the only way out of one."""
    trade = await repo.get_by_id(trade_id)
    if not trade or str(trade.user_id) != user_id or trade.exchange != "MCX":
        raise LookupError("Trade not found")
    if trade.status != TradeStatus.PENDING:
        raise ValueError(f"Only pending orders can be cancelled (trade is {trade.status})")

    try:
        broker = await get_zerodha_broker(user_id)
        lot_size = await _lot_size_for_metal_symbol(broker, trade.symbol)
    except McxNotConnectedError:
        lot_size = 1

    trade.status = TradeStatus.CANCELLED
    updated = await repo.update(trade)
    log.info("mcx_metals.trade.cancelled", symbol=trade.symbol)
    return _trade_dict(updated, lot_size)

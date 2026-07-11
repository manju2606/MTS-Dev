"""MCX Natural Gas: live quotes and paper trading.

Live prices come from Zerodha Kite (the connected broker's own MCX quote
feed) rather than the generic CompositeMarketDataClient, which only covers
NSE/BSE equities. MCX Natural Gas trades as a monthly futures contract, so
"the current price" first means resolving which specific contract
(tradingsymbol like "NATURALGAS26JULFUT") is the front month, via Kite's
instrument dump for the MCX segment.

Trading itself is paper-only: real orders reuse the same Trade domain model
and TradeRepository as equity paper trading (exchange="MCX"), just against a
real Kite-sourced price instead of a real order going to the exchange.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog

from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
from app.infra.brokers import session_store
from app.infra.brokers.zerodha import ZerodhaBroker

log = structlog.get_logger()

_IST = ZoneInfo("Asia/Kolkata")


def ist_now() -> datetime:
    """Current time in IST. Kite's historical_data() date-range params are
    plain "YYYY-MM-DD HH:MM:SS" strings interpreted as exchange-local (IST)
    time -- building them from naive datetime.now() silently uses whatever
    timezone the host/container's system clock happens to be in (typically
    UTC in Docker), truncating the query window by exactly the IST offset
    and making "recent" candle fetches miss the last ~5.5 hours."""
    return datetime.now(_IST)


# Public contract code (used in URLs/UI) -> Kite instrument "name" field.
# NGMINI's exact Kite name is best-effort (MCX's own convention is
# "NATGASMINI") -- resolve_contract() raises a clear, debuggable error
# listing near-matches if this ever needs correcting once live data is
# available to check against.
MCX_CONTRACTS: dict[str, str] = {
    "NG": "NATURALGAS",
    "NGMINI": "NATGASMINI",
}

# Specific-expiry NG contract codes ("NG_<3-letter month>") -- resolve_contract()
# parses the suffix against this table to pick a particular expiry instead of
# always the nearest unexpired one. Kite's tradingsymbol convention already
# uses these same abbreviations (e.g. "NATURALGAS26AUGFUT").
_MONTH_ABBR: dict[str, int] = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# Specific-expiry NG codes tracked by the background scheduler alongside the
# evergreen "NG" (front month) and "NGMINI" -- a plain list since which
# months are worth tracking is a product decision, not something Kite's
# instrument dump tells us. resolve_contract() already fails safely (a clear
# ValueError, caught+logged per-iteration by every scheduler loop) for a
# month MCX hasn't listed yet.
TRACKED_MCX_CONTRACTS: list[str] = [
    "NG", "NGMINI", "NG_AUG", "NG_SEP", "NG_OCT", "NG_NOV", "NG_DEC",
]

# MCX's instrument dump is large and only changes when contracts roll
# (monthly) -- cache it for a day instead of re-downloading on every quote.
_INSTRUMENTS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_INSTRUMENTS_TTL = 24 * 3600


class McxNotConnectedError(Exception):
    """Raised when the user hasn't connected a Zerodha account -- MCX quotes
    have no free/public source, unlike NSE/BSE."""


# Last-known-good quote per (user, contract), used to keep the dashboard
# usable across Zerodha's daily token expiry -- Kite invalidates yesterday's
# token every day with no refresh API (see zerodha_token_service.py's own
# docstring), so a hard failure here would otherwise mean the whole MCX
# section goes blank every single morning until the user reconnects. Stored
# in Redis (not the in-process _INSTRUMENTS_CACHE dict above) so it survives
# backend restarts and is visible across the app's 2 uvicorn workers.
_QUOTE_CACHE_PREFIX = "mcx_quote_cache:"
_QUOTE_CACHE_TTL = 3 * 24 * 3600  # survives a long weekend outage, not just overnight


def _quote_cache_key(user_id: str, contract: str) -> str:
    return f"{_QUOTE_CACHE_PREFIX}{user_id}:{contract.upper()}"


async def _cache_quote(user_id: str, contract: str, quote: dict) -> None:
    try:
        import json

        import redis.asyncio as aioredis

        from app.core.config import settings

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        payload = json.dumps({**quote, "as_of": datetime.utcnow().isoformat()})
        await r.set(_quote_cache_key(user_id, contract), payload, ex=_QUOTE_CACHE_TTL)
        await r.aclose()
    except Exception as exc:
        log.warning("mcx.quote_cache.write_failed", error=str(exc))


async def _get_cached_quote(user_id: str, contract: str) -> dict | None:
    try:
        import json

        import redis.asyncio as aioredis

        from app.core.config import settings

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        raw = await r.get(_quote_cache_key(user_id, contract))
        await r.aclose()
        return json.loads(raw) if raw else None
    except Exception as exc:
        log.warning("mcx.quote_cache.read_failed", error=str(exc))
        return None


async def get_zerodha_broker(user_id: str) -> ZerodhaBroker:
    broker = await session_store.get(user_id)
    if not isinstance(broker, ZerodhaBroker):
        raise McxNotConnectedError(
            "Connect your Zerodha account (Broker settings) to view live MCX "
            "Natural Gas prices and trade -- MCX has no free public data feed."
        )
    return broker


async def _get_mcx_instruments(broker: ZerodhaBroker) -> list[dict]:
    now = time.monotonic()
    cached = _INSTRUMENTS_CACHE.get("MCX")
    if cached and (now - cached[0]) < _INSTRUMENTS_TTL:
        return cached[1]
    instruments = await broker.get_instruments("MCX")
    _INSTRUMENTS_CACHE["MCX"] = (now, instruments)
    return instruments


async def resolve_contract(broker: ZerodhaBroker, contract: str = "NG") -> dict:
    """The current MCX futures contract for `contract`. Either a bare
    MCX_CONTRACTS key (e.g. "NG", "NGMINI") -- resolves to the front month,
    i.e. the nearest unexpired expiry -- or a `<key>_<3-letter month>` code
    (e.g. "NG_AUG") -- resolves to the nearest unexpired expiry falling in
    that specific month."""
    base, _, month_code = contract.upper().partition("_")
    kite_name = MCX_CONTRACTS.get(base)
    if kite_name is None:
        raise ValueError(
            f"Unknown MCX contract '{contract}' -- expected one of {list(MCX_CONTRACTS)}"
        )
    target_month: int | None = None
    if month_code:
        target_month = _MONTH_ABBR.get(month_code)
        if target_month is None:
            raise ValueError(
                f"Unknown expiry month '{month_code}' in contract '{contract}' -- "
                f"expected one of {list(_MONTH_ABBR)}"
            )

    instruments = await _get_mcx_instruments(broker)
    candidates = [
        i
        for i in instruments
        if str(i.get("name", "")).upper() == kite_name and i.get("instrument_type") == "FUT"
    ]
    if not candidates:
        near = sorted(
            {str(i.get("name", "")) for i in instruments if "GAS" in str(i.get("name", "")).upper()}
        )
        raise ValueError(
            f"No MCX futures found for '{kite_name}' (contract={contract}). "
            f"Instrument names containing 'GAS' in Kite's dump: {near or 'none'}"
        )

    def _expiry(c: dict) -> date:
        exp = c["expiry"]
        return exp if isinstance(exp, date) else datetime.strptime(str(exp), "%Y-%m-%d").date()

    today = date.today()
    unexpired = sorted((c for c in candidates if _expiry(c) >= today), key=_expiry)

    if target_month is not None:
        matching = [c for c in unexpired if _expiry(c).month == target_month]
        if not matching:
            available = sorted(_expiry(c).isoformat() for c in unexpired)
            raise ValueError(
                f"No unexpired '{kite_name}' contract found for expiry month '{month_code}' -- "
                f"MCX/Kite may not have listed it yet. Available unexpired expiries: "
                f"{available or 'none'}"
            )
        return matching[0]

    return unexpired[0] if unexpired else sorted(candidates, key=_expiry)[-1]


async def resolve_ng_contract(broker: ZerodhaBroker) -> dict:
    """Back-compat alias for resolve_contract(broker, "NG")."""
    return await resolve_contract(broker, "NG")


async def _fetch_live_quote(user_id: str, contract: str) -> dict:
    broker = await get_zerodha_broker(user_id)
    c = await resolve_contract(broker, contract)
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
        "name": MCX_CONTRACTS[contract.upper()],
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


async def get_quote(user_id: str, contract: str = "NG") -> dict:
    """Live MCX front-month contract quote: LTP, OHLC, volume, OI. Falls
    back to the last successfully fetched quote (marked stale=True, with an
    as_of timestamp) if Zerodha is unreachable right now -- either the
    session is missing entirely or today's token has expired (see
    McxNotConnectedError and zerodha_token_service.py). Only re-raises if
    there's no cached quote to fall back to (e.g. genuinely never connected
    before), since there's nothing meaningful to show in that case."""
    try:
        quote = await _fetch_live_quote(user_id, contract)
        quote["stale"] = False
        await _cache_quote(user_id, contract, quote)
        return quote
    except Exception as exc:
        cached = await _get_cached_quote(user_id, contract)
        if cached is None:
            raise
        log.warning(
            "mcx.quote.fallback_to_cache", user_id=user_id, contract=contract, error=str(exc)
        )
        cached["stale"] = True
        return cached


async def get_ng_quote(user_id: str) -> dict:
    """Back-compat alias for get_quote(user_id, "NG")."""
    return await get_quote(user_id, "NG")


# period -> (Kite interval, lookback days). Kite restricts how far back
# intraday intervals can be queried, so finer intervals get a shorter window;
# "day" candles can go back years.
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


async def get_history(user_id: str, period: str, contract: str = "NG") -> list[dict]:
    """MCX OHLCV history for the front-month contract, in the same
    {time, open, high, low, close, volume} shape the shared PriceChart
    component already expects (see components/price-chart.tsx)."""
    from datetime import timedelta

    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_contract(broker, contract)
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


async def get_ng_history(user_id: str, period: str) -> list[dict]:
    """Back-compat alias for get_history(user_id, period, "NG")."""
    return await get_history(user_id, period, "NG")


async def get_range_stats(user_id: str, contract: str = "NG") -> dict:
    """Day/week/month high-low for the front-month contract. Today's day
    high/low comes straight from the live quote (its own daily candle isn't
    closed yet); week/month roll up closed daily candles plus today's quote
    so the current session is reflected immediately, not just after close."""
    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_contract(broker, contract)
    quote = await get_quote(user_id, contract)

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


def _trade_dict(trade: Trade, lot_size: int) -> dict:
    from dataclasses import asdict

    d = asdict(trade)
    d["risk_reward_ratio"] = trade.risk_reward_ratio
    d["pnl"] = trade.pnl
    d["lots"] = round(trade.quantity / lot_size, 2) if lot_size else trade.quantity
    return d


async def _lot_size_for_symbol(broker: ZerodhaBroker, symbol: str) -> int:
    """Resolve lot size from a trade's own stored tradingsymbol -- correct
    even if that contract has since rolled/expired, unlike re-resolving
    "the current front month" which would return a different contract."""
    instruments = await _get_mcx_instruments(broker)
    for i in instruments:
        if i.get("tradingsymbol") == symbol:
            return int(i.get("lot_size", 1))
    return 100 if symbol.upper().startswith("NATGASMINI") else 1250


async def place_ng_trade(
    user_id: str,
    repo,  # TradeRepository
    signal: TradeSignal,
    lots: int,
    stop_loss: float,
    target: float,
    limit_price: float | None = None,
    contract: str = "NG",
) -> dict:
    broker = await get_zerodha_broker(user_id)
    c_info = await resolve_contract(broker, contract)
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
    log.info("mcx.trade.placed", symbol=tradingsymbol, lots=lots, signal=signal)
    return _trade_dict(saved, lot_size)


async def list_ng_trades(user_id: str, repo, trade_status: TradeStatus | None = None) -> list[dict]:
    broker = await session_store.get(user_id)
    trades = await repo.list_by_user(UUID(user_id), trade_status)
    mcx_trades = [t for t in trades if t.exchange == "MCX"]

    async def _lot_size(t: Trade) -> int:
        if isinstance(broker, ZerodhaBroker):
            try:
                return await _lot_size_for_symbol(broker, t.symbol)
            except Exception:
                pass
        return 100 if t.symbol.upper().startswith("NATGASMINI") else 1250

    return [_trade_dict(t, await _lot_size(t)) for t in mcx_trades]


async def close_ng_trade(
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
    lot_size = await _lot_size_for_symbol(broker, trade.symbol)

    trade.exit_price = price
    trade.closed_at = datetime.utcnow()
    trade.status = TradeStatus.CLOSED
    updated = await repo.update(trade)
    log.info("mcx.trade.closed", symbol=trade.symbol, exit_price=price)
    return _trade_dict(updated, lot_size)

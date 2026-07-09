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
from datetime import date, datetime
from uuid import UUID

import structlog

from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
from app.infra.brokers import session_store
from app.infra.brokers.zerodha import ZerodhaBroker

log = structlog.get_logger()

_NG_NAME = "NATURALGAS"

# MCX's instrument dump is large and only changes when contracts roll
# (monthly) -- cache it for a day instead of re-downloading on every quote.
_INSTRUMENTS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_INSTRUMENTS_TTL = 24 * 3600


class McxNotConnectedError(Exception):
    """Raised when the user hasn't connected a Zerodha account -- MCX quotes
    have no free/public source, unlike NSE/BSE."""


def _get_zerodha_broker(user_id: str) -> ZerodhaBroker:
    broker = session_store.get(user_id)
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


async def _resolve_ng_contract(broker: ZerodhaBroker) -> dict:
    """The current front-month MCX Natural Gas futures contract."""
    instruments = await _get_mcx_instruments(broker)
    candidates = [
        i
        for i in instruments
        if str(i.get("name", "")).upper() == _NG_NAME and i.get("instrument_type") == "FUT"
    ]
    if not candidates:
        raise ValueError("No MCX Natural Gas futures contracts found in Kite's instrument list")

    def _expiry(c: dict) -> date:
        exp = c["expiry"]
        return exp if isinstance(exp, date) else datetime.strptime(str(exp), "%Y-%m-%d").date()

    today = date.today()
    unexpired = sorted((c for c in candidates if _expiry(c) >= today), key=_expiry)
    return unexpired[0] if unexpired else sorted(candidates, key=_expiry)[-1]


async def get_ng_quote(user_id: str) -> dict:
    """Live MCX Natural Gas front-month contract: LTP, OHLC, volume, OI."""
    broker = _get_zerodha_broker(user_id)
    contract = await _resolve_ng_contract(broker)
    tradingsymbol = contract["tradingsymbol"]
    raw = await broker.get_raw_quote("MCX", tradingsymbol)

    ohlc = raw.get("ohlc", {}) or {}
    last_price = float(raw.get("last_price", 0.0))
    prev_close = float(ohlc.get("close", 0.0))
    change = round(last_price - prev_close, 2)
    change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0

    return {
        "tradingsymbol": tradingsymbol,
        "name": _NG_NAME,
        "expiry": str(contract["expiry"]),
        "lot_size": int(contract.get("lot_size", 1)),
        "tick_size": float(contract.get("tick_size", 0.1)),
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


def _trade_dict(trade: Trade, lot_size: int) -> dict:
    from dataclasses import asdict

    d = asdict(trade)
    d["risk_reward_ratio"] = trade.risk_reward_ratio
    d["pnl"] = trade.pnl
    d["lots"] = round(trade.quantity / lot_size, 2) if lot_size else trade.quantity
    return d


async def place_ng_trade(
    user_id: str,
    repo,  # TradeRepository
    signal: TradeSignal,
    lots: int,
    stop_loss: float,
    target: float,
    limit_price: float | None = None,
) -> dict:
    broker = _get_zerodha_broker(user_id)
    contract = await _resolve_ng_contract(broker)
    tradingsymbol = contract["tradingsymbol"]
    lot_size = int(contract.get("lot_size", 1))
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
    broker = session_store.get(user_id)
    lot_size = 1250  # MCX Natural Gas current lot size -- fallback if not connected
    if isinstance(broker, ZerodhaBroker):
        try:
            contract = await _resolve_ng_contract(broker)
            lot_size = int(contract.get("lot_size", lot_size))
        except Exception:
            pass
    trades = await repo.list_by_user(UUID(user_id), trade_status)
    mcx_trades = [t for t in trades if t.exchange == "MCX"]
    return [_trade_dict(t, lot_size) for t in mcx_trades]


async def close_ng_trade(
    user_id: str, repo, trade_id: UUID, exit_price: float | None = None
) -> dict:
    trade = await repo.get_by_id(trade_id)
    if not trade or str(trade.user_id) != user_id or trade.exchange != "MCX":
        raise LookupError("Trade not found")
    if trade.status != TradeStatus.OPEN:
        raise ValueError(f"Trade is already {trade.status}")

    broker = _get_zerodha_broker(user_id)
    lot_size = 1250
    if exit_price is not None:
        price = exit_price
    else:
        raw = await broker.get_raw_quote("MCX", trade.symbol)
        price = float(raw.get("last_price", 0.0))
    try:
        contract = await _resolve_ng_contract(broker)
        lot_size = int(contract.get("lot_size", lot_size))
    except Exception:
        pass

    trade.exit_price = price
    trade.closed_at = datetime.utcnow()
    trade.status = TradeStatus.CLOSED
    updated = await repo.update(trade)
    log.info("mcx.trade.closed", symbol=trade.symbol, exit_price=price)
    return _trade_dict(updated, lot_size)

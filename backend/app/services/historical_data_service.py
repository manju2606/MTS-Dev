"""Orchestrates historical OHLCV downloads and persistence to Mongo
(historical_candle_repo). Two download paths exist:

- download_batch_official(): uses the same connected Zerodha session as the
  MCX pages (session_store, official Kite Connect API) -- needs the account
  to have Kite Connect's paid Historical Data subscription, but needs no
  extra token from the user.
- download_batch(): uses Zerodha's `enctoken` (see zerodha_enctoken.py) --
  free, no subscription needed, but requires pasting a fresh token per
  session. Kept for accounts without the Historical Data subscription.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import structlog

from app.domain.models.historical_candle import HistoricalCandle
from app.infra.brokers import session_store, zerodha_enctoken
from app.infra.brokers.zerodha import ZerodhaBroker
from app.infra.db.repositories.historical_candle_repo import HistoricalCandleRepository

log = structlog.get_logger()

# Human-friendly labels for the MCX contract-family keys used elsewhere in
# the app (mcx_service.MCX_CONTRACTS, mcx_metals_service.MCX_METALS_CONTRACTS)
# -- these are app-level identifiers, not literal Zerodha tradingsymbols
# (which roll monthly), so the historical-data dropdown lists these and
# resolve_mcx_instrument() below maps whichever one is picked to today's
# actual front-month tradingsymbol.
MCX_CONTRACT_LABELS: dict[str, str] = {
    "NG": "Natural Gas",
    "NGMINI": "Natural Gas Mini",
    "ALUMINIUM": "Aluminium",
    "ALUMINI": "Aluminium Mini",
    "COPPER": "Copper",
    "LEAD": "Lead",
    "LEADMINI": "Lead Mini",
    "NICKEL": "Nickel",
    "ZINC": "Zinc",
    "ZINCMINI": "Zinc Mini",
    "GOLD": "Gold",
    "GOLDMINI": "Gold Mini",
    "GOLDTEN": "Gold Ten (10g)",
    "GOLDGUINEA": "Gold Guinea",
    "GOLDPETAL": "Gold Petal",
    "SILVER": "Silver",
    "SILVERMINI": "Silver Mini",
    "SILVERMICRO": "Silver Micro",
    "SILVER100": "Silver 100",
}


class NotConnectedError(Exception):
    pass


def list_mcx_contracts() -> list[dict]:
    return [{"value": key, "label": label} for key, label in MCX_CONTRACT_LABELS.items()]


def friendly_mcx_label(symbol: str) -> str | None:
    """Reverse-maps a resolved Zerodha tradingsymbol (e.g. "NATGASMINI26JULFUT",
    which rolls to a new literal string every month) back to the stable
    contract-family label a user actually picked (e.g. "Natural Gas Mini") --
    used so the "Already Downloaded" list stays recognizable across contract
    rollovers instead of showing a different cryptic code each month.

    Matches longest kite_name first -- e.g. "GOLDM26AUGFUT" starts with both
    "GOLD" (-> GOLD) and "GOLDM" (-> GOLDMINI); the longer, more specific
    match must win or every GOLDMINI/ZINCMINI/etc. contract would mislabel
    as its non-mini parent."""
    from app.services import mcx_metals_service, mcx_service

    all_contracts = {**mcx_service.MCX_CONTRACTS, **mcx_metals_service.MCX_METALS_CONTRACTS}
    symbol_u = symbol.upper()
    for key, kite_name in sorted(all_contracts.items(), key=lambda kv: -len(kv[1])):
        if symbol_u.startswith(kite_name):
            return MCX_CONTRACT_LABELS.get(key)
    return None


async def resolve_mcx_instrument(broker: ZerodhaBroker, contract_key: str) -> dict:
    """Maps an MCX_CONTRACT_LABELS key (e.g. "NG", "GOLD") to today's actual
    front-month Zerodha tradingsymbol + instrument_token via the same
    resolvers the MCX pages use. Note: MCX futures expire monthly, so a
    downloaded range only covers however long *this* contract has been
    trading -- not a continuous multi-year series across expiries."""
    from app.services import mcx_metals_service, mcx_service

    key = contract_key.upper()
    if key in mcx_service.MCX_CONTRACTS:
        return await mcx_service.resolve_contract(broker, key, allow_expired=True)
    if key in mcx_metals_service.MCX_METALS_CONTRACTS:
        return await mcx_metals_service.resolve_metal_contract(broker, key)
    raise ValueError(f"Unknown MCX contract '{contract_key}'")


def _date_chunks(
    from_dt: datetime, to_dt: datetime, interval: str
) -> list[tuple[datetime, datetime]]:
    max_days = zerodha_enctoken.MAX_DAYS_PER_REQUEST.get(interval, 60)
    chunks: list[tuple[datetime, datetime]] = []
    cursor = from_dt
    while cursor < to_dt:
        chunk_end = min(cursor + timedelta(days=max_days), to_dt)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end
    return chunks


async def download_symbol(
    enctoken: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    include_oi: bool,
    repo: HistoricalCandleRepository,
) -> dict:
    """Downloads and persists one symbol's full range, chunked to respect
    Kite's per-request date limits. Returns a per-symbol result summary --
    never raises, so one bad symbol in a batch doesn't abort the rest."""
    try:
        token = await zerodha_enctoken.resolve_instrument_token(symbol, exchange)
    except zerodha_enctoken.InstrumentNotFoundError as exc:
        return {"symbol": symbol, "ok": False, "error": str(exc), "candles_saved": 0}

    total_saved = 0
    for chunk_from, chunk_to in _date_chunks(from_dt, to_dt, interval):
        try:
            raw_candles = await zerodha_enctoken.fetch_historical_candles(
                enctoken, token, interval, chunk_from, chunk_to, include_oi
            )
        except zerodha_enctoken.EnctokenAuthError as exc:
            return {"symbol": symbol, "ok": False, "error": str(exc), "candles_saved": total_saved}
        except Exception as exc:
            log.warning(
                "historical_data.chunk_failed", symbol=symbol, chunk_from=chunk_from, error=str(exc)
            )
            continue

        candles = [
            HistoricalCandle(
                symbol=symbol,
                exchange=exchange,
                interval=interval,
                time=c["time"],
                open=c["open"],
                high=c["high"],
                low=c["low"],
                close=c["close"],
                volume=c["volume"],
                open_interest=c.get("open_interest"),
            )
            for c in raw_candles
        ]
        total_saved += await repo.upsert_many(candles)

    return {"symbol": symbol, "ok": True, "error": None, "candles_saved": total_saved}


async def download_batch(
    enctoken: str,
    symbols: list[str],
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    include_oi: bool,
    repo: HistoricalCandleRepository,
) -> list[dict]:
    await repo.ensure_indexes()
    results = []
    for symbol in symbols:
        result = await download_symbol(
            enctoken, symbol, exchange, interval, from_dt, to_dt, include_oi, repo
        )
        results.append(result)
    return results


async def get_zerodha_broker(user_id: str) -> ZerodhaBroker:
    broker = await session_store.get(user_id)
    if not isinstance(broker, ZerodhaBroker):
        raise NotConnectedError(
            "Connect your Zerodha account (Broker settings) to download historical data "
            "via the official API."
        )
    return broker


async def download_symbol_official(
    broker: ZerodhaBroker,
    symbol: str,
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    include_oi: bool,
    repo: HistoricalCandleRepository,
) -> dict:
    """Same chunked download as download_symbol(), but via the official Kite
    Connect API using an already-connected broker session (see
    get_zerodha_broker) instead of a pasted enctoken."""
    try:
        if exchange.upper() == "MCX":
            resolved = await resolve_mcx_instrument(broker, symbol)
            token = resolved["instrument_token"]
            storage_symbol = resolved["tradingsymbol"]
        else:
            token = await zerodha_enctoken.resolve_instrument_token(symbol, exchange)
            storage_symbol = symbol
    except (zerodha_enctoken.InstrumentNotFoundError, ValueError) as exc:
        return {"symbol": symbol, "ok": False, "error": str(exc), "candles_saved": 0}

    total_saved = 0
    for chunk_from, chunk_to in _date_chunks(from_dt, to_dt, interval):
        try:
            raw_candles = await broker.get_historical_candles(
                token,
                interval,
                chunk_from.strftime("%Y-%m-%d %H:%M:%S"),
                chunk_to.strftime("%Y-%m-%d %H:%M:%S"),
            )
        except Exception as exc:
            log.warning(
                "historical_data.official_chunk_failed",
                symbol=symbol,
                chunk_from=chunk_from,
                error=str(exc),
            )
            continue

        candles = [
            HistoricalCandle(
                symbol=storage_symbol,
                exchange=exchange,
                interval=interval,
                time=c["date"].replace(tzinfo=None),
                open=c["open"],
                high=c["high"],
                low=c["low"],
                close=c["close"],
                volume=c["volume"],
                open_interest=c.get("oi") if include_oi else None,
            )
            for c in raw_candles
        ]
        total_saved += await repo.upsert_many(candles)

    return {
        "symbol": storage_symbol,
        "ok": True,
        "error": None,
        "candles_saved": total_saved,
    }


async def download_batch_official(
    user_id: str,
    symbols: list[str],
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    include_oi: bool,
    repo: HistoricalCandleRepository,
) -> list[dict]:
    broker = await get_zerodha_broker(user_id)
    await repo.ensure_indexes()
    results = []
    for symbol in symbols:
        result = await download_symbol_official(
            broker, symbol, exchange, interval, from_dt, to_dt, include_oi, repo
        )
        results.append(result)
    return results

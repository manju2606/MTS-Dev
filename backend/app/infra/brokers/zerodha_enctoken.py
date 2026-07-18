"""Zerodha historical-data access via `enctoken` -- the session cookie Kite's
own web frontend (kite.zerodha.com) uses, as opposed to the official Kite
Connect API in zerodha.py (which needs a paid Historical Data subscription).
Same technique as github.com/vikassharma545/Historical-Market-data-From-Zerodha.

The user extracts their enctoken from the browser (F12 → Application →
Cookies → kite.zerodha.com → enctoken) and pastes it in -- this module never
touches their actual Zerodha password. enctoken lives about as long as a
regular Kite access_token (roughly one trading day), so there's no
persistence here; it's supplied fresh with each download request.

This hits Kite's internal "oms" endpoints, not the documented Kite Connect
API -- it works because it's the same session your browser already has, but
it's outside Zerodha's official API surface.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta

import httpx
import structlog

log = structlog.get_logger()

_HISTORICAL_URL = "https://kite.zerodha.com/oms/instruments/historical/{token}/{interval}"
_INSTRUMENTS_URL = "https://api.kite.trade/instruments"

# Kite's documented per-request date-range ceilings by interval -- the same
# limits apply here since this hits the same backend as the official API.
MAX_DAYS_PER_REQUEST: dict[str, int] = {
    "minute": 60,
    "3minute": 100,
    "5minute": 100,
    "10minute": 100,
    "15minute": 200,
    "30minute": 200,
    "60minute": 400,
    "day": 2000,
}

_instruments_cache: list[dict] | None = None
_instruments_cached_at: datetime | None = None
_INSTRUMENTS_TTL = timedelta(hours=24)


class EnctokenAuthError(Exception):
    """enctoken missing/expired -- Kite returned 403 or a non-success status."""


class InstrumentNotFoundError(Exception):
    pass


def _auth_headers(enctoken: str) -> dict:
    return {
        "Authorization": f"enctoken {enctoken}",
        "X-Kite-Version": "3",
    }


async def _load_instruments(force_refresh: bool = False) -> list[dict]:
    global _instruments_cache, _instruments_cached_at

    fresh = (
        _instruments_cache is not None
        and _instruments_cached_at is not None
        and datetime.utcnow() - _instruments_cached_at < _INSTRUMENTS_TTL
    )
    if fresh and not force_refresh:
        return _instruments_cache  # type: ignore[return-value]

    async with httpx.AsyncClient() as client:
        resp = await client.get(_INSTRUMENTS_URL, timeout=30)
        resp.raise_for_status()

    reader = csv.DictReader(io.StringIO(resp.text))
    rows = [
        {
            "instrument_token": int(row["instrument_token"]),
            "tradingsymbol": row["tradingsymbol"],
            "exchange": row["exchange"],
        }
        for row in reader
    ]
    _instruments_cache = rows
    _instruments_cached_at = datetime.utcnow()
    log.info("zerodha_enctoken.instruments.loaded", count=len(rows))
    return rows


async def resolve_instrument_token(symbol: str, exchange: str) -> int:
    instruments = await _load_instruments()
    symbol_u, exchange_u = symbol.upper(), exchange.upper()
    for row in instruments:
        if row["tradingsymbol"] == symbol_u and row["exchange"] == exchange_u:
            return int(row["instrument_token"])

    # Instrument master rolled over (e.g. new F&O series) -- refresh once
    # before giving up.
    instruments = await _load_instruments(force_refresh=True)
    for row in instruments:
        if row["tradingsymbol"] == symbol_u and row["exchange"] == exchange_u:
            return int(row["instrument_token"])

    raise InstrumentNotFoundError(f"No instrument found for {exchange_u}:{symbol_u}")


async def fetch_historical_candles(
    enctoken: str,
    instrument_token: int,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
    include_oi: bool = False,
) -> list[dict]:
    """Raw OHLCV(+OI) candles for one instrument_token/interval/date-range
    chunk. Caller is responsible for splitting a longer range into chunks
    that respect MAX_DAYS_PER_REQUEST -- this makes exactly one request."""
    url = _HISTORICAL_URL.format(token=instrument_token, interval=interval)
    params = {
        "from": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "oi": "1" if include_oi else "0",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=_auth_headers(enctoken), params=params, timeout=30)

    if resp.status_code == 403:
        raise EnctokenAuthError("enctoken missing or expired -- reconnect and paste a fresh one")
    resp.raise_for_status()

    body = resp.json()
    if body.get("status") != "success":
        raise EnctokenAuthError(body.get("message") or "Kite historical data request failed")

    candles = body["data"]["candles"]
    rows = []
    for c in candles:
        row = {
            "time": datetime.fromisoformat(c[0]).replace(tzinfo=None),
            "open": float(c[1]),
            "high": float(c[2]),
            "low": float(c[3]),
            "close": float(c[4]),
            "volume": int(c[5]),
        }
        if include_oi and len(c) > 6:
            row["open_interest"] = int(c[6])
        rows.append(row)
    return rows

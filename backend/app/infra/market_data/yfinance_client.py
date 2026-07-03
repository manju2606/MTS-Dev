import asyncio
import math

import structlog
import yfinance as yf

from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote

log = structlog.get_logger()

_SUFFIX_TO_EXCHANGE = {".NS": "NSE", ".BO": "BSE"}


def _normalise_symbol(symbol: str) -> str:
    """Add .NS suffix if no exchange suffix present; default exchange is NSE."""
    upper = symbol.upper()
    if upper.endswith(".NS") or upper.endswith(".BO"):
        return upper
    return f"{upper}.NS"


def _exchange_from_symbol(symbol: str) -> str:
    for suffix, exchange in _SUFFIX_TO_EXCHANGE.items():
        if symbol.upper().endswith(suffix):
            return exchange
    return "NSE"


def _safe_float(val: object, default: float = 0.0) -> float:
    if val is None:
        return default
    f = float(val)  # type: ignore[arg-type]
    return default if math.isnan(f) else f


def _fetch_quote_sync(symbol: str) -> Quote:
    """Blocking yfinance call — must be run in a thread pool executor.

    Tries 1-minute intraday history first (last bar ~2–5 min old) for
    fresher prices; falls back to fast_info (~15 min delay) if intraday
    data is unavailable (weekend, holiday, pre-market).
    """
    ticker = yf.Ticker(symbol)

    # ── Try 1-minute intraday first ──────────────────────────────────────────
    price_f: float = 0.0
    prev_close_f: float = 0.0
    day_high: float = 0.0
    day_low: float = 0.0
    volume: int = 0
    used_intraday = False

    try:
        hist = ticker.history(period="2d", interval="1m", auto_adjust=True)
        if not hist.empty:
            closes = hist["Close"].dropna()
            if not closes.empty:
                price_f = round(_safe_float(closes.iloc[-1]), 2)
                if price_f > 0:
                    last_date = hist.index[-1].date()
                    today_mask = [ts.date() == last_date for ts in hist.index]
                    today_hist = hist[today_mask]
                    prior_closes = closes[[ts.date() < last_date for ts in closes.index]]

                    prev_close_f = (
                        round(_safe_float(prior_closes.iloc[-1], price_f), 2)
                        if not prior_closes.empty else price_f
                    )
                    day_high = round(_safe_float(today_hist["High"].max(), price_f), 2) if not today_hist.empty else price_f
                    day_low  = round(_safe_float(today_hist["Low"].min(),  price_f), 2) if not today_hist.empty else price_f
                    volume   = int(today_hist["Volume"].sum()) if not today_hist.empty else 0
                    used_intraday = True
    except Exception:
        pass  # fall through to fast_info

    # ── Fall back to fast_info ────────────────────────────────────────────────
    if not used_intraday:
        try:
            fi = ticker.fast_info
            price = fi.last_price
            prev_close = fi.previous_close
        except KeyError as exc:
            raise ValueError(f"Symbol '{symbol}' not found") from exc

        if price is None or math.isnan(float(price)):
            raise ValueError(f"No market data available for '{symbol}'")

        price_f = round(_safe_float(price), 2)
        prev_close_f = round(_safe_float(prev_close, price_f), 2)
        day_high = round(_safe_float(fi.day_high, price_f), 2)
        day_low  = round(_safe_float(fi.day_low,  price_f), 2)
        volume   = int(_safe_float(fi.last_volume, 0.0))

    if price_f == 0.0:
        raise ValueError(f"Zero price returned for '{symbol}'")

    change = round(price_f - prev_close_f, 2)
    change_pct = round(change / prev_close_f * 100, 4) if prev_close_f else 0.0

    return Quote(
        symbol=symbol,
        price=price_f,
        change=change,
        change_pct=change_pct,
        volume=volume,
        day_high=day_high,
        day_low=day_low,
        prev_close=prev_close_f,
        exchange=_exchange_from_symbol(symbol),
    )


class YFinanceClient(MarketDataClient):
    async def get_quote(self, symbol: str) -> Quote:
        normalised = _normalise_symbol(symbol)
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, _fetch_quote_sync, normalised)
        except ValueError:
            raise
        except Exception as exc:
            log.warning("market_data.get_quote.error", symbol=normalised, error=str(exc))
            raise RuntimeError(f"Market data fetch failed for '{normalised}'") from exc

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        normalised = [_normalise_symbol(s) for s in symbols]
        loop = asyncio.get_running_loop()

        async def _safe_fetch(sym: str) -> Quote | None:
            try:
                return await loop.run_in_executor(None, _fetch_quote_sync, sym)
            except Exception as exc:
                log.warning("market_data.get_quotes.skipped", symbol=sym, error=str(exc))
                return None

        results = await asyncio.gather(*[_safe_fetch(s) for s in normalised])
        return [q for q in results if q is not None]

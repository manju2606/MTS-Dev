"""Market-wide Liquidity Flow scanner. Orchestrates infra candle fetches and the pure engine.

Ranks symbols by the engine's confidence score. Symbols that fail to load are counted
and skipped. They never fail the whole scan.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

import structlog

from app.domain.services.liquidity_flow.engine import analyze
from app.infra.market_data.liquidity_candles import fetch_candles
from app.infra.scanner.universe import NIFTY_50, NIFTY_100, NIFTY_200

log = structlog.get_logger()

UNIVERSES: dict[str, list[str]] = {
    "nifty50": NIFTY_50,
    "nifty100": NIFTY_100,
    "nifty200": NIFTY_200,
}
_CONCURRENCY = 6
_PER_SYMBOL_TIMEOUT = 30.0
_TTL_SECONDS = 600
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = asyncio.Lock()

Side = Literal["bullish", "bearish", "all"]


async def _scan_raw(universe: str) -> dict[str, Any]:
    symbols = UNIVERSES[universe]
    sem = asyncio.Semaphore(_CONCURRENCY)
    rows: list[dict[str, Any]] = []
    failed: list[str] = []

    async def one(sym: str) -> None:
        async with sem:
            try:
                candles = await asyncio.wait_for(fetch_candles(sym, "1d"), _PER_SYMBOL_TIMEOUT)
                result = analyze(candles, holding_period="1–5 sessions")
            except Exception as exc:  # short history, upstream failure, timeout
                log.info("liquidity_scan.skip", symbol=sym, reason=str(exc))
                failed.append(sym)
                return
        rec = result.recommendation
        rows.append(
            {
                "symbol": sym,
                "signal": rec["signal"],
                "confidence": rec["confidence"],
                "entry_price": rec["entry_price"],
                "stop_loss": rec["stop_loss"],
                "target": rec["target"],
                "risk_reward_ratio": rec["risk_reward_ratio"],
                "trend": result.trend,
                "last_close": result.last_close,
                "net_score": rec["net_score"],
                # Fresh = happened in the last two closed bars. Used by alerts.
                "fresh_events": [
                    e.kind for e in result.structure_events if e.index >= result.n_bars - 2
                ],
                "fresh_sweeps": [s.side for s in result.sweeps if s.index >= result.n_bars - 2],
            }
        )

    await asyncio.gather(*(one(s) for s in symbols))
    return {
        "universe": universe,
        "scanned": len(symbols),
        "analysed": len(rows),
        "failed": sorted(failed),
        "rows": rows,
        "generated_at": int(time.time()),
    }


async def scan(
    universe: str, side: Side = "all", limit: int = 20, fresh_only: bool = False
) -> dict[str, Any]:
    if universe not in UNIVERSES:
        raise ValueError(f"Unknown universe: {universe}")
    cached = _cache.get(universe)
    if cached and time.monotonic() - cached[0] < _TTL_SECONDS:
        raw = cached[1]
    else:
        async with _lock:
            cached = _cache.get(universe)
            if cached and time.monotonic() - cached[0] < _TTL_SECONDS:
                raw = cached[1]
            else:
                raw = await _scan_raw(universe)
                _cache[universe] = (time.monotonic(), raw)

    rows: list[dict[str, Any]] = list(raw["rows"])
    want = {"bullish": "BUY", "bearish": "SELL"}
    picked = [
        r for r in rows if r["signal"] != "HOLD" and (side == "all" or r["signal"] == want[side])
    ]
    if fresh_only:
        picked = [r for r in picked if r["fresh_events"] or r["fresh_sweeps"]]
    picked.sort(key=lambda r: (float(r["confidence"]), float(r["risk_reward_ratio"])), reverse=True)
    return {
        "universe": universe,
        "side": side,
        "scanned": raw["scanned"],
        "analysed": raw["analysed"],
        "failed_count": len(raw["failed"]),
        "matches": len(picked),
        "results": picked[:limit],
        "generated_at": raw["generated_at"],
    }

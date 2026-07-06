"""NSE / BSE Options Chain — powered by yfinance."""
from __future__ import annotations

import asyncio
from functools import partial

import structlog
from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/options", tags=["options"])
log = structlog.get_logger()


def _norm(sym: str) -> str:
    s = sym.upper().strip()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


# ── sync helpers (run in thread pool) ────────────────────────────────────────

def _get_expiries(symbol: str) -> list[str]:
    import yfinance as yf
    tk = yf.Ticker(symbol)
    return list(tk.options or [])


def _get_chain(symbol: str, expiry: str) -> dict:
    import numpy as np
    import yfinance as yf

    tk = yf.Ticker(symbol)
    try:
        chain = tk.option_chain(expiry)
    except Exception as exc:
        raise ValueError(f"Failed to fetch chain: {exc}") from exc

    spot = None
    try:
        info = tk.fast_info
        spot = float(getattr(info, "last_price", None) or getattr(info, "previous_close", None) or 0) or None
    except Exception:
        pass

    def _rows(df, opt_type: str) -> list[dict]:
        rows = []
        for _, r in df.iterrows():
            iv = r.get("impliedVolatility", None)
            rows.append({
                "type": opt_type,
                "strike": float(r.get("strike", 0)),
                "last_price": float(r.get("lastPrice", 0)),
                "bid": float(r.get("bid", 0)),
                "ask": float(r.get("ask", 0)),
                "volume": int(r.get("volume", 0) or 0),
                "open_interest": int(r.get("openInterest", 0) or 0),
                "iv": round(float(iv) * 100, 2) if iv and not (isinstance(iv, float) and np.isnan(iv)) else None,
                "change": round(float(r.get("change", 0)), 2),
                "change_pct": round(float(r.get("percentChange", 0)), 2),
                "in_the_money": bool(r.get("inTheMoney", False)),
            })
        return rows

    calls = _rows(chain.calls, "call")
    puts  = _rows(chain.puts,  "put")

    # PCR by open interest
    total_call_oi = sum(r["open_interest"] for r in calls)
    total_put_oi  = sum(r["open_interest"] for r in puts)
    pcr = round(total_put_oi / total_call_oi, 3) if total_call_oi else None

    # Max pain — strike where total option buyer loss is maximised
    strikes = sorted({r["strike"] for r in calls + puts})
    max_pain = None
    if strikes and spot:
        min_loss = float("inf")
        for s in strikes:
            call_loss = sum(max(0.0, s - r["strike"]) * r["open_interest"] for r in calls)
            put_loss  = sum(max(0.0, r["strike"] - s) * r["open_interest"] for r in puts)
            total = call_loss + put_loss
            if total < min_loss:
                min_loss = total
                max_pain = s

    # ATM strike
    atm = min(strikes, key=lambda s: abs(s - spot)) if spot and strikes else None

    return {
        "symbol": symbol,
        "expiry": expiry,
        "spot": spot,
        "atm_strike": atm,
        "pcr": pcr,
        "max_pain": max_pain,
        "total_call_oi": total_call_oi,
        "total_put_oi": total_put_oi,
        "calls": calls,
        "puts": puts,
    }


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{symbol}/expiries")
async def get_expiries(symbol: str, _: CurrentUser) -> list[str]:
    sym = _norm(symbol)
    loop = asyncio.get_event_loop()
    try:
        expiries = await loop.run_in_executor(None, partial(_get_expiries, sym))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not expiries:
        raise HTTPException(status_code=404, detail=f"No options data for {sym}")
    return expiries


@router.get("/{symbol}/chain")
async def get_chain(
    symbol: str,
    _: CurrentUser,
    expiry: str = Query(..., description="Expiry date string, e.g. 2026-07-31"),
) -> dict:
    sym = _norm(symbol)
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, partial(_get_chain, sym, expiry))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return data

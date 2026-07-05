"""Custom multi-factor stock screener — technical + fundamental criteria."""
from __future__ import annotations

import asyncio
from functools import partial

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.models.screener import CRITERIA_FIELDS, OPERATORS, UNIVERSES, SavedScreen, ScreenerCriterion
from app.infra.db.repositories import screener_repo
from app.infra.scanner.universe import NIFTY_INDICES, NIFTY_50, NIFTY_100, NIFTY_MIDCAP_150, NIFTY_SMALLCAP_250

router = APIRouter(prefix="/screener", tags=["custom-screener"])
log = structlog.get_logger()

_UNIVERSE_MAP: dict[str, list[str]] = {
    "nifty50":           NIFTY_50,
    "nifty100":          NIFTY_100,
    "niftymidcap150":    NIFTY_MIDCAP_150,
    "niftysmallcap250":  NIFTY_SMALLCAP_250,
}

# ── fetch helpers ─────────────────────────────────────────────────────────────

def _fetch_symbol_data(symbol: str) -> dict | None:
    """Fetch technical + fundamental data for one symbol."""
    try:
        import numpy as np
        import pandas as pd
        import yfinance as yf

        tk = yf.Ticker(symbol)
        hist = tk.history(period="3mo", interval="1d")
        if hist.empty or len(hist) < 20:
            return None

        close = hist["Close"]
        volume = hist["Volume"]

        # ── Technicals ────────────────────────────────────────────────────────
        # RSI (14)
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, float("nan"))
        rsi = float((100 - 100 / (1 + rs)).iloc[-1])

        # MACD histogram
        ema12 = close.ewm(span=12).mean()
        ema26 = close.ewm(span=26).mean()
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9).mean()
        macd_hist = float((macd_line - signal_line).iloc[-1])

        # SMA ratios
        sma20 = float(close.rolling(20).mean().iloc[-1])
        sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else sma20
        price = float(close.iloc[-1])
        prev  = float(close.iloc[-2]) if len(close) >= 2 else price
        sma20_ratio = round((price / sma20 - 1) * 100, 2) if sma20 else 0
        sma50_ratio = round((price / sma50 - 1) * 100, 2) if sma50 else 0

        # Volume ratio
        avg_vol = float(volume.rolling(20).mean().iloc[-1])
        vol_ratio = round(float(volume.iloc[-1]) / avg_vol, 2) if avg_vol else 1.0

        # Change %
        change_pct = round((price - prev) / prev * 100, 2) if prev else 0

        # ATR %
        high = hist["High"]
        low  = hist["Low"]
        tr   = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr_pct = round(float(tr.rolling(14).mean().iloc[-1]) / price * 100, 2) if price else 0

        # ── Fundamentals ──────────────────────────────────────────────────────
        info = {}
        try:
            info = tk.info or {}
        except Exception:
            pass

        pe  = info.get("trailingPE") or info.get("forwardPE")
        pb  = info.get("priceToBook")
        mcap_cr = (info.get("marketCap") or 0) / 1e7  # convert to crores
        dy  = (info.get("dividendYield") or 0) * 100
        roe = (info.get("returnOnEquity") or 0) * 100
        de  = info.get("debtToEquity") or 0
        rg  = (info.get("revenueGrowth") or 0) * 100

        return {
            "symbol": symbol,
            "name": info.get("shortName") or symbol.replace(".NS", "").replace(".BO", ""),
            "price": round(price, 2),
            "change_pct": change_pct,
            # technicals
            "rsi": round(rsi, 1),
            "macd_hist": round(macd_hist, 4),
            "sma20_ratio": sma20_ratio,
            "sma50_ratio": sma50_ratio,
            "volume_ratio": vol_ratio,
            "atr_pct": atr_pct,
            # fundamentals
            "pe_ratio": round(float(pe), 1) if pe else None,
            "pb_ratio": round(float(pb), 2) if pb else None,
            "market_cap_cr": round(mcap_cr, 0) if mcap_cr else None,
            "dividend_yield": round(dy, 2) if dy else None,
            "roe": round(roe, 1) if roe else None,
            "debt_to_equity": round(float(de), 2) if de else None,
            "revenue_growth": round(rg, 1) if rg else None,
        }
    except Exception as exc:
        log.debug("screener.fetch_error", symbol=symbol, error=str(exc))
        return None


def _matches(row: dict, criteria: list[dict]) -> bool:
    OPS = {"<": float.__lt__, ">": float.__gt__, "<=": float.__le__, ">=": float.__ge__}
    for c in criteria:
        val = row.get(c["field"])
        if val is None:
            return False
        op_fn = OPS.get(c["operator"])
        if not op_fn:
            continue
        if not op_fn(float(val), float(c["value"])):
            return False
    return True


# ── endpoints ─────────────────────────────────────────────────────────────────

class CriterionIn(BaseModel):
    field: str
    operator: str
    value: float

class RunScreenRequest(BaseModel):
    universe: str = "nifty50"
    criteria: list[CriterionIn] = []
    limit: int = 20


@router.post("/run")
async def run_screen(body: RunScreenRequest, _: CurrentUser) -> dict:
    if body.universe not in _UNIVERSE_MAP:
        raise HTTPException(status_code=422, detail=f"universe must be one of {list(_UNIVERSE_MAP)}")
    for c in body.criteria:
        if c.field not in CRITERIA_FIELDS:
            raise HTTPException(status_code=422, detail=f"Unknown field: {c.field}")
        if c.operator not in OPERATORS:
            raise HTTPException(status_code=422, detail=f"Unknown operator: {c.operator}")

    symbols = _UNIVERSE_MAP[body.universe]
    limit = min(body.limit, 50)

    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, partial(_fetch_symbol_data, s)) for s in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    criteria_dicts = [c.model_dump() for c in body.criteria]
    matches = [
        r for r in results
        if isinstance(r, dict) and _matches(r, criteria_dicts)
    ][:limit]

    return {
        "universe": body.universe,
        "total_scanned": len([r for r in results if isinstance(r, dict)]),
        "matches": len(matches),
        "results": matches,
    }


class SaveScreenRequest(BaseModel):
    name: str
    universe: str = "nifty50"
    criteria: list[CriterionIn] = []


@router.post("/saved")
async def save_screen(body: SaveScreenRequest, current_user: CurrentUser) -> dict:
    screen = SavedScreen(
        user_id=str(current_user.id),
        name=body.name,
        universe=body.universe,
        criteria=[ScreenerCriterion(field=c.field, operator=c.operator, value=c.value)
                  for c in body.criteria],
    )
    saved = await screener_repo.create(screen)
    return {"id": str(saved.id), "name": saved.name, "universe": saved.universe,
            "criteria": [{"field": c.field, "operator": c.operator, "value": c.value}
                         for c in saved.criteria]}


@router.get("/saved")
async def list_saved(current_user: CurrentUser) -> list[dict]:
    screens = await screener_repo.list_by_user(str(current_user.id))
    return [{"id": str(s.id), "name": s.name, "universe": s.universe,
             "criteria": [{"field": c.field, "operator": c.operator, "value": c.value}
                          for c in s.criteria],
             "created_at": s.created_at.isoformat()} for s in screens]


@router.delete("/saved/{screen_id}")
async def delete_screen(screen_id: str, current_user: CurrentUser) -> dict:
    deleted = await screener_repo.delete(screen_id, str(current_user.id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Screen not found")
    return {"deleted": True}


@router.get("/meta")
async def screener_meta(_: CurrentUser) -> dict:
    return {"fields": CRITERIA_FIELDS, "operators": OPERATORS, "universes": UNIVERSES}

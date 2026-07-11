"""Metals-AI Pro v1 — rule-based AI confidence score for MCX Base &
Precious Metals intraday trading. Sibling to mcx_ai_score_service.py
(Natural Gas): the six generic OHLCV/OI categories (Trend, Momentum,
Volume, Price Action, Order Flow, Volatility) are imported and reused
unchanged -- they're pure technical-indicator math via
app/infra/mcx/ng_indicators.py, with no NG-specific assumptions.

Two categories differ from NG's score:
- Correlation gets a per-metal ticker map instead of NG's crude-oil/Henry-Hub
  pair: Gold/Silver/Copper have reliable Yahoo Finance futures tickers
  (GC=F/SI=F/HG=F); Aluminium/Lead/Nickel/Zinc don't, so their commodity
  correlate is simply excluded (USD/INR + DXY still checked) -- same
  graceful-degradation pattern the score already uses elsewhere for
  uncomputable checks.
- News Filter is omitted entirely -- no metals news feed exists (confirmed
  acceptable; the score already normalizes against whichever categories are
  actually present, so this doesn't skew the 0-100 scale, just narrows it).
"""

from __future__ import annotations

from app.infra.mcx import ng_indicators as ind
from app.services.mcx_ai_score_service import (
    _category,
    _check,
    _classify,
    _fetch_candles,
    _score_momentum,
    _score_order_flow,
    _score_price_action,
    _score_trend,
    _score_volatility,
    _score_volume,
)
from app.services.mcx_service import get_zerodha_broker

# Which correlation-ticker family each contract code belongs to -- several
# codes (e.g. every Gold variant) share the same underlying spot/futures
# correlate.
_METAL_FAMILY: dict[str, str] = {
    "ALUMINIUM": "ALUMINIUM", "ALUMINI": "ALUMINIUM",
    "COPPER": "COPPER",
    "LEAD": "LEAD", "LEADMINI": "LEAD",
    "NICKEL": "NICKEL",
    "ZINC": "ZINC", "ZINCMINI": "ZINC",
    "GOLD": "GOLD", "GOLDMINI": "GOLD", "GOLDTEN": "GOLD",
    "GOLDGUINEA": "GOLD", "GOLDPETAL": "GOLD",
    "SILVER": "SILVER", "SILVERMINI": "SILVER",
    "SILVERMICRO": "SILVER", "SILVER100": "SILVER",
}

# yfinance tickers for the Correlation category, by metal family --
# "commodity": None means no reliable free ticker exists for that metal, so
# that leg of the check is excluded rather than guessed at.
_CORRELATION_TICKERS_BY_FAMILY: dict[str, dict[str, str | None]] = {
    "GOLD": {"commodity": "GC=F", "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "SILVER": {"commodity": "SI=F", "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "COPPER": {"commodity": "HG=F", "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "ALUMINIUM": {"commodity": None, "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "LEAD": {"commodity": None, "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "NICKEL": {"commodity": None, "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
    "ZINC": {"commodity": None, "usd_inr": "INR=X", "dxy": "DX-Y.NYB"},
}


def _fetch_metal_correlation_sync(family: str) -> dict:
    import yfinance as yf

    tickers = _CORRELATION_TICKERS_BY_FAMILY[family]
    out: dict[str, float | None] = {}
    for key, ticker in tickers.items():
        if ticker is None:
            out[key] = None
            continue
        try:
            hist = yf.Ticker(ticker).history(period="10d", interval="1d")
            if len(hist) >= 2:
                first, last = float(hist["Close"].iloc[0]), float(hist["Close"].iloc[-1])
                out[key] = round((last - first) / first * 100, 2) if first else None
            else:
                out[key] = None
        except Exception:
            out[key] = None
    return out


def _score_metal_correlation(corr: dict, direction: str, family: str) -> dict:
    bull = direction == "BUY"
    pts = 1.0

    def _aligned(pct: float | None, invert: bool = False) -> bool:
        if pct is None:
            return False
        up = pct > 0
        if invert:
            up = not up
        return up if bull else not up

    commodity_ticker = _CORRELATION_TICKERS_BY_FAMILY[family]["commodity"]
    checks = []
    excluded = []
    if commodity_ticker:
        commodity_pct = corr.get("commodity")
        checks.append(
            _check(
                f"{family.title()} futures ({commodity_ticker}) alignment",
                _aligned(commodity_pct),
                pts,
                f"{commodity_pct}%",
            )
        )
    else:
        excluded.append(f"{family.title()} spot/futures correlate (no reliable free ticker)")

    inr, dxy = corr.get("usd_inr"), corr.get("dxy")
    checks.append(_check("USD/INR alignment", _aligned(inr), pts, f"{inr}%"))
    checks.append(_check("DXY alignment (inverse)", _aligned(dxy, invert=True), pts, f"{dxy}%"))
    excluded.append("News sentiment (no metals news source configured)")
    return _category("Correlation", 5, checks, excluded)


async def compute_metal_ai_score(
    user_id: str, direction: str, capital: float = 100_000.0, contract: str = "GOLD"
) -> dict:
    """Full Metals-AI Pro v1 breakdown for one direction (BUY or SELL) on
    any of the 17 tracked metals contracts, using 15-minute candles as the
    primary scoring timeframe (same convention as compute_ng_ai_score)."""
    from app.services.mcx_metals_service import resolve_metal_contract

    broker = await get_zerodha_broker(user_id)
    contract_info = await resolve_metal_contract(broker, contract)
    instrument_token = contract_info["instrument_token"]

    candles = await _fetch_candles(broker, instrument_token, "15m")
    if len(candles) < 60:
        raise ValueError(
            f"Not enough MCX {contract} history yet ({len(candles)} 15m candles) -- need at "
            "least 60 for a reliable score. Try again once more of the trading day has passed."
        )

    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    family = _METAL_FAMILY[contract.upper()]
    corr = _fetch_metal_correlation_sync(family)

    categories = [
        _score_trend(c, direction),
        _score_momentum(h, low, c, direction),
        _score_volume(candles, direction),
        _score_price_action(candles, direction),
        _score_order_flow(candles, direction),
        _score_volatility(candles, direction),
        _score_metal_correlation(corr, direction, family),
    ]

    earned = sum(cat["earned"] for cat in categories)
    available = sum(cat["available"] for cat in categories)
    score_pct = round(earned / available * 100, 1) if available else 0.0
    verdict = _classify(score_pct)

    price = c[-1]
    atr = ind.atr(h, low, c) or 0.0
    sl_distance = round(1.5 * atr, 2)
    if direction == "BUY":
        stop_loss = round(price - sl_distance, 2)
        target_1 = round(price + sl_distance, 2)
        target_2 = round(price + 2 * sl_distance, 2)
    else:
        stop_loss = round(price + sl_distance, 2)
        target_1 = round(price - sl_distance, 2)
        target_2 = round(price - 2 * sl_distance, 2)

    lot_size = int(contract_info.get("lot_size", 1))
    risk_amount = round(capital * 0.01, 2)
    position_size = int(risk_amount / sl_distance) if sl_distance else 0
    # Never round up to a minimum of 1 lot -- risk controls override signals
    # (see CLAUDE.md), same rule as NG's own sizing.
    lots = position_size // lot_size if lot_size else 0
    one_lot_risk = round(lot_size * sl_distance, 2) if lot_size else None
    sizing_note = (
        None
        if lots >= 1
        else (
            f"Risk budget (₹{risk_amount:,.0f}) can't cover 1 lot's stop-loss risk "
            f"(₹{one_lot_risk:,.0f}) -- increase capital, tighten the stop, or skip this trade."
        )
    )

    return {
        "tradingsymbol": contract_info["tradingsymbol"],
        "contract": contract.upper(),
        "direction": direction,
        "price": price,
        "score_pct": score_pct,
        "verdict": verdict,
        "points_earned": round(earned, 2),
        "points_available": round(available, 2),
        "points_nominal_total": 100,
        "categories": categories,
        "entry": {
            "entry_price": price,
            "stop_loss": stop_loss,
            "stop_loss_distance": sl_distance,
            "target_1": target_1,
            "target_1_pct_of_position": 30,
            "target_2": target_2,
            "target_2_pct_of_position": 40,
            "trail_remainder_note": (
                "Trail remaining 30% using 20 EMA / Supertrend once T1 hits; "
                "move SL to breakeven after 1R."
            ),
        },
        "position_sizing": {
            "capital": capital,
            "risk_pct": 1.0,
            "risk_amount": risk_amount,
            "lot_size": lot_size,
            "one_lot_risk": one_lot_risk,
            "suggested_lots": lots,
            "note": sizing_note,
        },
        "risk_rules": {
            "max_trades_per_day": 3,
            "stop_after_consecutive_losses": 2,
            "daily_loss_limit_pct": 2.0,
            "daily_profit_target_pct": "2-3",
            "never_average_down": True,
        },
        "candles_used": len(candles),
        "correlation_inputs": corr,
    }

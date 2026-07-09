"""NG-AI Pro v1 — rule-based AI confidence score for MCX Natural Gas
intraday trading.

Score is computed per category using only the sub-indicators that are
actually computable today. Volume Profile, Cumulative Delta, bid/ask
imbalance, and the EIA/OPEC/FOMC/RBI news-event filter all need data this
app doesn't have (tick-level trade data, L2 market depth, and an economic
calendar covering US energy-market events respectively) -- those
sub-indicators are excluded from BOTH the earned points AND each
category's denominator, then the total is normalized back to 0-100. That
way a score >=85 always means "strong across everything we can actually
measure", not diluted by categories that always read zero.

No machine learning here by design -- NG-AI Pro v1's own spec calls for
XGBoost/LSTM only "after collecting sufficient historical data", and MCX
candle collection only just started, so there's nothing to train on yet.
"""

from __future__ import annotations

from datetime import timedelta

from app.infra.mcx import ng_indicators as ind
from app.services.mcx_service import get_zerodha_broker, ist_now

_INTERVAL_MAP = {"1m": "minute", "5m": "5minute", "15m": "15minute"}
_LOOKBACK_DAYS = {"1m": 2, "5m": 5, "15m": 10}

# yfinance tickers for the Correlation category.
_CORRELATION_TICKERS = {
    "crude_oil": "CL=F",
    "henry_hub": "NG=F",
    "usd_inr": "INR=X",
    "dxy": "DX-Y.NYB",
}


async def _fetch_candles(broker, instrument_token: int, interval: str) -> list[dict]:
    days = _LOOKBACK_DAYS[interval]
    to_dt = ist_now()
    from_dt = to_dt - timedelta(days=days)
    return await broker.get_historical_candles(
        instrument_token,
        _INTERVAL_MAP[interval],
        from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        to_dt.strftime("%Y-%m-%d %H:%M:%S"),
    )


def _fetch_correlation_sync() -> dict:
    import yfinance as yf

    out = {}
    for key, ticker in _CORRELATION_TICKERS.items():
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


def _check(label: str, passed: bool, points: float, note: str = "") -> dict:
    return {
        "label": label,
        "passed": passed,
        "points": round(points if passed else 0, 2),
        "max": round(points, 2),
        "note": note,
    }


def _category(name: str, weight: int, checks: list[dict], excluded: list[str]) -> dict:
    earned = sum(c["points"] for c in checks)
    available = sum(c["max"] for c in checks)
    return {
        "name": name,
        "weight": weight,
        "earned": round(earned, 2),
        "available": round(available, 2),
        "checks": checks,
        "excluded": excluded,
    }


def _score_trend(c: list[float], direction: str) -> dict:
    price = c[-1]
    ema20, ema50, ema200 = ind.ema(c, 20), ind.ema(c, 50), ind.ema(c, 200)
    pts = 5.0
    bull = direction == "BUY"
    above20 = ema20 is not None and (price > ema20 if bull else price < ema20)
    above50 = ema50 is not None and (price > ema50 if bull else price < ema50)
    above200 = ema200 is not None and (price > ema200 if bull else price < ema200)
    align_20_50 = (
        ema20 is not None and ema50 is not None and (ema20 > ema50 if bull else ema20 < ema50)
    )
    align_50_200 = (
        ema50 is not None and ema200 is not None and (ema50 > ema200 if bull else ema50 < ema200)
    )
    checks = [
        _check("Price vs 20 EMA", above20, pts),
        _check("Price vs 50 EMA", above50, pts),
        _check("Price vs 200 EMA", above200, pts),
        _check("20 EMA vs 50 EMA alignment", align_20_50, pts),
        _check("50 EMA vs 200 EMA alignment", align_50_200, pts),
    ]
    return _category("Trend", 25, checks, [])


def _score_momentum(h: list[float], low: list[float], c: list[float], direction: str) -> dict:
    bull = direction == "BUY"
    pts = 3.0
    rsi = ind.rsi(c)
    macd = ind.macd(c)
    stoch = ind.stochastic(h, low, c)
    roc = ind.roc(c)

    rsi_ok = rsi is not None and (50 < rsi < 70 if bull else 30 < rsi < 50)
    macd_ok = macd is not None and (macd[0] > macd[1] if bull else macd[0] < macd[1])
    hist_ok = macd is not None and (macd[2] > 0 if bull else macd[2] < 0)
    stoch_ok = stoch is not None and (
        (stoch[0] > stoch[1] and stoch[0] < 80) if bull else (stoch[0] < stoch[1] and stoch[0] > 20)
    )
    roc_ok = roc is not None and (roc > 0 if bull else roc < 0)

    checks = [
        _check("RSI", rsi_ok, pts, f"RSI={rsi}" if rsi is not None else "unavailable"),
        _check("MACD crossover", macd_ok, pts, f"MACD={macd}" if macd else "unavailable"),
        _check("MACD histogram", hist_ok, pts),
        _check("Stochastic", stoch_ok, pts, f"%K/%D={stoch}" if stoch else "unavailable"),
        _check("ROC", roc_ok, pts, f"ROC={roc}" if roc is not None else "unavailable"),
    ]
    return _category("Momentum", 15, checks, [])


def _score_volume(candles: list[dict], direction: str) -> dict:
    bull = direction == "BUY"
    pts = 3.0
    vols = ind.volumes(candles)
    price = float(candles[-1]["close"])
    spike = ind.volume_spike(vols)
    vwap = ind.vwap(candles[-20:])

    spike_ok = spike is not None and spike[0]
    vwap_ok = vwap is not None and (price > vwap if bull else price < vwap)

    checks = [
        _check("Volume spike", spike_ok, pts, f"ratio={spike[1]}x" if spike else "unavailable"),
        _check("VWAP", vwap_ok, pts, f"VWAP={vwap}" if vwap is not None else "unavailable"),
    ]
    excluded = ["Volume Profile (needs tick data)", "Delta / Cumulative Delta (needs tick data)"]
    return _category("Volume", 15, checks, excluded)


def _score_price_action(candles: list[dict], direction: str) -> dict:
    bull = direction == "BUY"
    pts = 3.75
    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    breakout = ind.swing_breakout(h, low, c)
    candle = ind.candlestick_confirmation(candles)

    breakout_ok = breakout["breakout_up"] if bull else breakout["breakout_down"]
    structure_ok = breakout["hh_hl"] if bull else breakout["lh_ll"]
    candle_ok = candle["bullish"] if bull else candle["bearish"]
    # Retest: crude proxy -- price still trading in the direction of the
    # breakout on the most recent bar (didn't immediately reverse back through it).
    retest_ok = breakout_ok and (c[-1] > c[-2] if bull else c[-1] < c[-2])

    structure_label = (
        "Higher-highs/higher-lows structure" if bull else "Lower-highs/lower-lows structure"
    )
    checks = [
        _check("Breakout", breakout_ok, pts),
        _check("Retest (approximate)", retest_ok, pts, "proxy: held direction on last bar"),
        _check(structure_label, structure_ok, pts),
        _check("Candlestick confirmation", candle_ok, pts),
    ]
    return _category("Price Action", 15, checks, [])


def _score_order_flow(candles: list[dict], direction: str) -> dict:
    pts = 2.5
    ois = ind.open_interests(candles)
    closes = ind.closes(candles)
    lookback = min(10, len(ois) - 1)

    if lookback < 1 or not ois[-1] or not ois[-1 - lookback]:
        oi_trend_ok = False
        classification = None
    else:
        oi_change = ois[-1] - ois[-1 - lookback]
        price_change = closes[-1] - closes[-1 - lookback]
        oi_trend_ok = oi_change > 0
        classification = ind.oi_classification(price_change, oi_change)

    favorable = {
        "BUY": {"long_build_up", "short_covering"},
        "SELL": {"short_build_up", "long_unwinding"},
    }
    classification_ok = classification in favorable[direction] if classification else False

    checks = [
        _check("Open Interest trend", oi_trend_ok, pts),
        _check(
            "Price/OI quadrant (long build-up / short covering / etc.)",
            classification_ok,
            pts,
            classification or "unavailable",
        ),
    ]
    return _category("Order Flow", 10, checks, ["Bid/Ask imbalance (needs Level-2 market depth)"])


def _score_volatility(candles: list[dict], direction: str) -> dict:
    bull = direction == "BUY"
    pts = 2.0
    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    price = c[-1]

    atr_s = ind.atr_series(h, low, c)
    atr_expanding = len(atr_s) >= 6 and atr_s[-1] > atr_s[-6]
    bb = ind.bollinger(c)
    bb_ok = bb is not None and (price > bb[0] if bull else price < bb[2])
    adx = ind.adx(h, low, c)
    adx_ok = adx is not None and adx > 25
    chop = ind.choppiness_index(h, low, c)
    chop_ok = chop is not None and chop < 38
    kelt = ind.keltner(h, low, c)
    kelt_ok = kelt is not None and (price > kelt[0] if bull else price < kelt[2])

    chop_note = f"CI={chop}" if chop is not None else "unavailable"
    checks = [
        _check("ATR expansion", atr_expanding, pts),
        _check("Bollinger breakout", bb_ok, pts, f"bands={bb}" if bb else "unavailable"),
        _check("ADX > 25", adx_ok, pts, f"ADX={adx}" if adx is not None else "unavailable"),
        _check("Choppiness (trending, not choppy)", chop_ok, pts, chop_note),
        _check("Keltner breakout", kelt_ok, pts),
    ]
    return _category("Volatility", 10, checks, [])


def _score_correlation(corr: dict, direction: str) -> dict:
    bull = direction == "BUY"
    pts = 1.0

    def _aligned(pct: float | None, invert: bool = False) -> bool:
        if pct is None:
            return False
        up = pct > 0
        if invert:
            up = not up
        return up if bull else not up

    crude, henry = corr.get("crude_oil"), corr.get("henry_hub")
    inr, dxy = corr.get("usd_inr"), corr.get("dxy")
    checks = [
        _check("Crude Oil (CL=F) alignment", _aligned(crude), pts, f"{crude}%"),
        _check("Henry Hub (NG=F) alignment", _aligned(henry), pts, f"{henry}%"),
        _check("USD/INR alignment", _aligned(inr), pts, f"{inr}%"),
        _check("DXY alignment (inverse)", _aligned(dxy, invert=True), pts, f"{dxy}%"),
    ]
    excluded = ["LNG news sentiment (no news source configured)"]
    return _category("Correlation", 5, checks, excluded)


def _score_news() -> dict:
    excluded = [
        "EIA inventory report",
        "OPEC meetings",
        "FOMC",
        "RBI",
        "geopolitical events -- verify manually before trading",
    ]
    return _category("News Filter", 5, [], excluded)


def _classify(score_pct: float) -> str:
    if score_pct >= 85:
        return "TRADE"
    if score_pct >= 70:
        return "WATCHLIST"
    return "NO_TRADE"


async def compute_ng_ai_score(
    user_id: str, direction: str, capital: float = 100_000.0, contract: str = "NG"
) -> dict:
    """Full NG-AI Pro v1 breakdown for one direction (BUY or SELL) on either
    contract ("NG" or "NGMINI"), using 15-minute candles as the primary
    timeframe (per the strategy's 1m/5m/15m multi-timeframe intent, 15m is
    used as the scoring timeframe; 1m/5m are available via the same candle
    fetch for finer entry timing)."""
    from app.services.mcx_service import resolve_contract as resolve_mcx_contract

    broker = await get_zerodha_broker(user_id)
    contract_info = await resolve_mcx_contract(broker, contract)
    instrument_token = contract_info["instrument_token"]

    candles = await _fetch_candles(broker, instrument_token, "15m")
    if len(candles) < 60:
        raise ValueError(
            f"Not enough MCX {contract} history yet ({len(candles)} 15m candles) -- need at "
            "least 60 for a reliable score. Try again once more of the trading day has passed."
        )

    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    corr = _fetch_correlation_sync()

    categories = [
        _score_trend(c, direction),
        _score_momentum(h, low, c, direction),
        _score_volume(candles, direction),
        _score_price_action(candles, direction),
        _score_order_flow(candles, direction),
        _score_volatility(candles, direction),
        _score_correlation(corr, direction),
        _score_news(),
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
    # Never round up to a minimum of 1 lot -- if the risk budget can't cover
    # even one full lot's stop-loss distance, the honest answer is 0 lots,
    # not silently taking on more risk than the stated 1% (risk controls
    # override signals, never the other way around; see CLAUDE.md).
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

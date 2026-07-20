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

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.infra.mcx import ng_indicators as ind
from app.services.mcx_service import get_zerodha_broker, ist_now


@dataclass(frozen=True)
class NgAiScoreParams:
    """Tunable thresholds within the Momentum/Volatility categories, plus
    the verdict cutoffs -- everything else in the scorer (Trend, Price
    Action, Order Flow, Correlation) is structural (breakout/alignment
    checks) rather than a numeric threshold, so there's nothing to "tighten"
    there without inventing a new check from scratch."""

    rsi_bull_lo: float = 50.0
    rsi_bull_hi: float = 70.0
    rsi_bear_lo: float = 30.0
    rsi_bear_hi: float = 50.0
    stoch_bull_max: float = 80.0  # %K must stay below this on a BUY
    stoch_bear_min: float = 20.0  # %K must stay above this on a SELL
    adx_min: float = 25.0
    choppiness_max: float = 38.0
    trade_threshold: float = 85.0
    watchlist_threshold: float = 70.0


# v1.0 is the score exactly as originally specified (unchanged default for
# every existing caller that doesn't pass a version). v2.0 raises the bar in
# every category that has an actual numeric threshold to raise, aiming for
# fewer, higher-conviction TRADE-tier calls -- same "which specific rule
# changed" concreteness as RSI Reversion's v1.0/v2.0 split.
#
# Unlike RSI, there's no historical-candle replay backtest for this scorer
# (mcx_backtest_service.py only evaluates signals already logged *live* over
# time, via mcx_trade_signals) -- correlation/news inputs are live snapshots,
# not a storable historical series, so a proper walk-forward comparison
# isn't achievable the way it was for RSI. v2.0 is therefore NOT a validated
# improvement, just a deliberately tighter variant to run alongside v1.0 and
# judge later once enough real signals have accumulated under both.
NG_AI_SCORE_VERSIONS: dict[str, NgAiScoreParams] = {
    "v1.0": NgAiScoreParams(),
    "v2.0": NgAiScoreParams(
        rsi_bull_lo=55.0, rsi_bull_hi=68.0, rsi_bear_lo=32.0, rsi_bear_hi=45.0,
        stoch_bull_max=75.0, stoch_bear_min=25.0,
        adx_min=30.0, choppiness_max=35.0,
        trade_threshold=88.0, watchlist_threshold=75.0,
    ),
}

_INTERVAL_MAP = {"1m": "minute", "5m": "5minute", "15m": "15minute"}
_LOOKBACK_DAYS = {"1m": 2, "5m": 5, "15m": 10}

# How far back "recent" NG news reaches, and how far a keyword-scored
# average sentiment has to lean before it's treated as opposing a
# direction -- a razor-thin average from coarse keyword scoring shouldn't
# flip a trade verdict on its own (see ng_news_fetcher.py's own docstring
# on the sentiment approach's limits).
_NEWS_LOOKBACK_HOURS = 48
_NEWS_SENTIMENT_DEADBAND = 0.1

# Supply-shock / conflict terms that the generic bullish/bearish sentiment
# scorer routinely misses -- e.g. "More LNG Carriers Brave the Strait of
# Hormuz Despite Renewed Hostilities" (an actual fetched article) scores
# ~0 (neutral) under keyword-sentiment scoring despite being exactly the
# kind of supply-risk headline that moves NG prices. Historically these
# events are NG-bullish (LNG shipping-lane risk, production/pipeline
# outages), so detection is scored as supporting BUY -- same "one input
# among several, not a signal on its own" caveat as the sentiment check
# above. Only scans articles already fetched by ng_news_fetcher.py, which
# itself only keeps articles mentioning an NG-specific keyword -- a
# geopolitical story that never mentions gas/energy won't reach this list.
_GEOPOLITICAL_KEYWORDS = [
    "iran", "israel", "houthi", "strait of hormuz", "red sea",
    "hostilit", "military strike", "airstrike", "missile attack",
    "war", "conflict escalat", "sanctions", "pipeline attack",
    "naval blockade", "tanker attack", "gulf tension",
    "middle east tension", "supply disruption", "opec+ cut",
]


def _mentions_geopolitical_risk(item: dict) -> bool:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    return any(kw in text for kw in _GEOPOLITICAL_KEYWORDS)

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


async def _recent_ng_news() -> list[dict]:
    """Reads whatever the scheduler's own NG news job (every 30 min, see
    scheduler.py) already fetched and persisted -- this function runs on
    every score computation (both directions, both contracts, every 5 min
    via the signal-check job), so it must not itself hit the RSS feeds live
    each time."""
    try:
        from app.infra.db.repositories.mcx_news_repo import McxNewsRepository

        since = datetime.utcnow() - timedelta(hours=_NEWS_LOOKBACK_HOURS)
        return await McxNewsRepository().get_recent(limit=50, since=since)
    except Exception:
        return []


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


def _score_momentum(
    h: list[float], low: list[float], c: list[float], direction: str, params: NgAiScoreParams
) -> dict:
    bull = direction == "BUY"
    pts = 3.0
    rsi = ind.rsi(c)
    macd = ind.macd(c)
    stoch = ind.stochastic(h, low, c)
    roc = ind.roc(c)

    rsi_ok = rsi is not None and (
        params.rsi_bull_lo < rsi < params.rsi_bull_hi
        if bull
        else params.rsi_bear_lo < rsi < params.rsi_bear_hi
    )
    macd_ok = macd is not None and (macd[0] > macd[1] if bull else macd[0] < macd[1])
    hist_ok = macd is not None and (macd[2] > 0 if bull else macd[2] < 0)
    stoch_ok = stoch is not None and (
        (stoch[0] > stoch[1] and stoch[0] < params.stoch_bull_max)
        if bull
        else (stoch[0] < stoch[1] and stoch[0] > params.stoch_bear_min)
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


def _score_volatility(candles: list[dict], direction: str, params: NgAiScoreParams) -> dict:
    bull = direction == "BUY"
    pts = 2.0
    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    price = c[-1]

    atr_s = ind.atr_series(h, low, c)
    atr_expanding = len(atr_s) >= 6 and atr_s[-1] > atr_s[-6]
    bb = ind.bollinger(c)
    bb_ok = bb is not None and (price > bb[0] if bull else price < bb[2])
    adx = ind.adx(h, low, c)
    adx_ok = adx is not None and adx > params.adx_min
    chop = ind.choppiness_index(h, low, c)
    chop_ok = chop is not None and chop < params.choppiness_max
    kelt = ind.keltner(h, low, c)
    kelt_ok = kelt is not None and (price > kelt[0] if bull else price < kelt[2])

    chop_note = f"CI={chop}" if chop is not None else "unavailable"
    checks = [
        _check("ATR expansion", atr_expanding, pts),
        _check("Bollinger breakout", bb_ok, pts, f"bands={bb}" if bb else "unavailable"),
        _check(f"ADX > {params.adx_min:g}", adx_ok, pts, f"ADX={adx}" if adx is not None else "unavailable"),
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


def _score_news(news_items: list[dict], direction: str) -> dict:
    # Still no economic-calendar API -- these four remain genuinely
    # unmeasured, unlike LNG/NG news sentiment and geopolitical-risk
    # keywords below, which are now real.
    excluded = [
        "EIA inventory report",
        "OPEC meetings",
        "FOMC",
        "RBI",
    ]
    if not news_items:
        return _category(
            "News Filter", 10, [],
            [
                "Recent NG news sentiment (no articles fetched yet)",
                "Geopolitical risk keywords (no articles fetched yet)",
                *excluded,
            ],
        )

    avg_sentiment = sum(n["sentiment_score"] for n in news_items) / len(news_items)
    bull = direction == "BUY"
    opposes = (
        avg_sentiment < -_NEWS_SENTIMENT_DEADBAND
        if bull
        else avg_sentiment > _NEWS_SENTIMENT_DEADBAND
    )

    geo_hits = [n for n in news_items if _mentions_geopolitical_risk(n)]
    geo_detected = len(geo_hits) > 0
    geo_aligned = geo_detected if bull else not geo_detected
    geo_note = (
        f"{len(geo_hits)} article(s), e.g. \"{geo_hits[0]['title']}\""
        if geo_hits
        else "no geopolitical risk keywords in recent coverage"
    )

    checks = [
        _check(
            f"Recent NG news sentiment ({avg_sentiment:+.2f})",
            not opposes,
            5.0,
            f"{len(news_items)} articles in the last {_NEWS_LOOKBACK_HOURS}h",
        ),
        _check("Geopolitical risk keywords", geo_aligned, 5.0, geo_note),
    ]
    return _category("News Filter", 10, checks, excluded)


def _classify(score_pct: float, params: NgAiScoreParams) -> str:
    if score_pct >= params.trade_threshold:
        return "TRADE"
    if score_pct >= params.watchlist_threshold:
        return "WATCHLIST"
    return "NO_TRADE"


def _summarize_checks(checks: list[dict]) -> tuple[list[str], list[str]]:
    def _label(c: dict) -> str:
        return c["label"] + (f" ({c['note']})" if c.get("note") else "")

    passed = [_label(c) for c in checks if c["passed"]]
    failed = [_label(c) for c in checks if not c["passed"] and c["max"] > 0]
    return passed, failed


def _reason_for(
    categories: list[dict], names: list[str], label: str, caveat: str | None = None
) -> str:
    """Renders the already-computed category checks as a plain-language
    paragraph, grouped under one of the spec's four reason buckets
    (Technical/Fundamental/Sentiment/Macro) -- no new data, no LLM call,
    just an honest readout of what the score already checked, in the same
    spirit as every other "excluded, no data source" note elsewhere in this
    file: never state a reason the underlying check didn't actually make."""
    cats = [c for c in categories if c["name"] in names]
    if not cats:
        return f"No {label.lower()} data source configured for this contract."

    all_checks = [chk for c in cats for chk in c["checks"]]
    passed, failed = _summarize_checks(all_checks)
    earned = sum(c["earned"] for c in cats)
    available = sum(c["available"] for c in cats)
    pct = round(earned / available * 100) if available else 0

    parts = [f"{label}: {pct}% ({earned:.1f}/{available:.1f} pts)."]
    if passed:
        parts.append("Supporting: " + "; ".join(passed) + ".")
    if failed:
        parts.append("Against: " + "; ".join(failed) + ".")
    if caveat:
        parts.append(caveat)
    return " ".join(parts)


def build_reasoning(
    categories: list[dict], direction: str, price: float, stop_loss: float
) -> dict:
    """Technical/Fundamental/Sentiment/Macro reasons + an alternative
    scenario + an invalidation level, all derived from the same category
    checks compute_ng_ai_score()/compute_metal_ai_score() already ran --
    the mapping: Technical <- Trend/Momentum/Volume/Price Action/Volatility
    (pure price & indicator checks), Macro <- Correlation (cross-asset
    alignment: crude/Henry Hub or per-metal futures, USD/INR, DXY),
    Sentiment <- News Filter. There's no earnings/balance-sheet data source
    for commodity futures, so Fundamental instead reads Order Flow (OI
    positioning) as the closest real proxy for supply/demand pressure this
    app can actually measure -- flagged as a proxy rather than presented as
    if it were equity-style fundamentals."""
    technical = _reason_for(
        categories, ["Trend", "Momentum", "Volume", "Price Action", "Volatility"], "Technical"
    )
    macro = _reason_for(categories, ["Correlation"], "Macro")
    sentiment = _reason_for(categories, ["News Filter"], "Sentiment")
    fundamental = _reason_for(
        categories, ["Order Flow"], "Fundamental",
        caveat=(
            "No earnings/balance-sheet data applies to commodity futures -- "
            "showing Open Interest positioning as the closest available supply/demand proxy."
        ),
    )

    opposite = "SELL" if direction == "BUY" else "BUY"
    sl_distance = abs(round(price - stop_loss, 2))
    bull = direction == "BUY"
    mirrored_target = round(price - sl_distance, 2) if bull else round(price + sl_distance, 2)
    mirrored_stop = round(price + sl_distance, 2) if bull else round(price - sl_distance, 2)
    alternative_scenario = (
        f"If this {direction} thesis is wrong and price instead moves like a {opposite} setup, "
        f"the mirrored case (same ATR-based distance) would target ~{mirrored_target} with its "
        f"own stop near {mirrored_stop} -- not a second signal, just what the opposite read "
        "looks like."
    )
    invalidation_level = (
        f"Invalidated on a close beyond {stop_loss} (the same 1.5x ATR stop used for position "
        "sizing) -- the technical/momentum alignment behind this score no longer holds past "
        "that level."
    )

    return {
        "technical_reason": technical,
        "fundamental_reason": fundamental,
        "sentiment_reason": sentiment,
        "macro_reason": macro,
        "alternative_scenario": alternative_scenario,
        "invalidation_level": invalidation_level,
    }


async def compute_ng_ai_score(
    user_id: str,
    direction: str,
    capital: float = 100_000.0,
    contract: str = "NG",
    version: str = "v1.0",
) -> dict:
    """Full NG-AI Pro breakdown for one direction (BUY or SELL) on either
    contract ("NG" or "NGMINI"), using 15-minute candles as the primary
    timeframe (per the strategy's 1m/5m/15m multi-timeframe intent, 15m is
    used as the scoring timeframe; 1m/5m are available via the same candle
    fetch for finer entry timing). version="v1.0" (original) or "v2.0"
    (tighter thresholds, see NG_AI_SCORE_VERSIONS) -- NOT validated the way
    RSI Reversion's v2.0 was, see that dict's own docstring."""
    from app.services.mcx_service import resolve_contract as resolve_mcx_contract

    if version not in NG_AI_SCORE_VERSIONS:
        raise ValueError(f"Unknown NG-AI Score version '{version}' -- expected one of "
                          f"{list(NG_AI_SCORE_VERSIONS)}")
    params = NG_AI_SCORE_VERSIONS[version]

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
    news_items = await _recent_ng_news()

    categories = [
        _score_trend(c, direction),
        _score_momentum(h, low, c, direction, params),
        _score_volume(candles, direction),
        _score_price_action(candles, direction),
        _score_order_flow(candles, direction),
        _score_volatility(candles, direction, params),
        _score_correlation(corr, direction),
        _score_news(news_items, direction),
    ]

    earned = sum(cat["earned"] for cat in categories)
    available = sum(cat["available"] for cat in categories)
    score_pct = round(earned / available * 100, 1) if available else 0.0
    verdict = _classify(score_pct, params)

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
        "version": version,
        "direction": direction,
        "price": price,
        "score_pct": score_pct,
        "verdict": verdict,
        "points_earned": round(earned, 2),
        "points_available": round(available, 2),
        "points_nominal_total": 100,
        "categories": categories,
        "entry": {
            "as_of": ist_now().isoformat(),
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
        "reasoning": build_reasoning(categories, direction, price, stop_loss),
    }

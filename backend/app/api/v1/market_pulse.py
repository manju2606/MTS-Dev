"""Market Pulse — scans 200+ NSE/BSE stocks, surfaces top BUY/SELL picks with AI analysis."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass

from fastapi import APIRouter, Query

from app.api.deps import AIDep, CurrentUser, MarketDataDep
from app.infra.ai.technical import fetch_indicators
from app.infra.scanner.market_scanner import ScanResult, scan
from app.infra.scanner.universe import NIFTY_500, SYMBOL_SECTOR

router = APIRouter(prefix="/market-pulse", tags=["market-pulse"])


@dataclass
class SentimentTag:
    label: str
    color: str  # green | red | amber | blue | zinc


@dataclass
class PulseCard:
    # From quick scan
    symbol: str
    sector: str
    name: str
    price: float
    change_pct: float
    volume: int
    week52_high: float
    week52_low: float
    sma20: float
    sma50: float
    rsi: float
    momentum_score: float
    value_score: float
    combined_score: float
    signal: str
    # From AI deep analysis
    ai_confidence: float
    entry_price: float
    stop_loss: float
    target: float
    risk_reward_ratio: float
    holding_period: str
    explanation: str
    engine: str
    sentiment_tags: list[SentimentTag]


@dataclass
class MarketOverview:
    scanned: int
    bullish: int
    bearish: int
    neutral: int
    bullish_pct: float
    bearish_pct: float
    sector_sentiment: dict[str, str]  # sector → "bullish"|"bearish"|"neutral"


@dataclass
class MarketPulseResult:
    overview: MarketOverview
    buy_picks: list[PulseCard]
    sell_picks: list[PulseCard]


def _sentiment_tags(r: ScanResult) -> list[SentimentTag]:
    tags: list[SentimentTag] = []

    # Trend
    if r.price > r.sma20 > r.sma50:
        tags.append(SentimentTag("Strong Uptrend", "green"))
    elif r.price > r.sma20:
        tags.append(SentimentTag("Weak Uptrend", "green"))
    elif r.price < r.sma20 < r.sma50:
        tags.append(SentimentTag("Downtrend", "red"))
    else:
        tags.append(SentimentTag("Sideways", "zinc"))

    # RSI
    if r.rsi < 30:
        tags.append(SentimentTag(f"RSI {r.rsi:.0f} Oversold", "green"))
    elif r.rsi < 45:
        tags.append(SentimentTag(f"RSI {r.rsi:.0f} Weak", "amber"))
    elif r.rsi > 70:
        tags.append(SentimentTag(f"RSI {r.rsi:.0f} Overbought", "red"))
    elif r.rsi > 55:
        tags.append(SentimentTag(f"RSI {r.rsi:.0f} Strong", "green"))

    # 52-week position
    w52_range = r.week52_high - r.week52_low
    if w52_range > 0:
        pos = (r.price - r.week52_low) / w52_range
        if pos >= 0.85:
            tags.append(SentimentTag("Near 52W High", "blue"))
        elif pos <= 0.15:
            tags.append(SentimentTag("Near 52W Low", "amber"))

    # Volume
    if r.volume > 0:
        if r.change_pct > 0:
            tags.append(SentimentTag("High Volume", "blue"))
        else:
            tags.append(SentimentTag("Sell Volume", "red"))

    return tags[:4]


async def _enrich_with_ai(
    scan_result: ScanResult,
    market_data: MarketDataDep,
    ai_client: AIDep,
) -> PulseCard | None:
    try:
        quote, ta = await asyncio.gather(
            market_data.get_quote(scan_result.symbol),
            fetch_indicators(scan_result.symbol),
        )
        rec = await ai_client.analyze(symbol=scan_result.symbol, quote=quote, ta=ta)
        return PulseCard(
            symbol=scan_result.symbol,
            sector=SYMBOL_SECTOR.get(scan_result.symbol, "Other"),
            name=scan_result.name,
            price=scan_result.price,
            change_pct=scan_result.change_pct,
            volume=scan_result.volume,
            week52_high=scan_result.week52_high,
            week52_low=scan_result.week52_low,
            sma20=scan_result.sma20,
            sma50=scan_result.sma50,
            rsi=scan_result.rsi,
            momentum_score=scan_result.momentum_score,
            value_score=scan_result.value_score,
            combined_score=scan_result.combined_score,
            signal=rec.signal,
            ai_confidence=rec.confidence,
            entry_price=rec.entry_price,
            stop_loss=rec.stop_loss,
            target=rec.target,
            risk_reward_ratio=rec.risk_reward_ratio,
            holding_period=rec.holding_period,
            explanation=rec.explanation,
            engine=rec.engine,
            sentiment_tags=_sentiment_tags(scan_result),
        )
    except Exception:
        return None


def _sector_sentiment(results: list[ScanResult]) -> dict[str, str]:
    sector_scores: dict[str, list[float]] = {}
    for r in results:
        sec = SYMBOL_SECTOR.get(r.symbol, "Other")
        sector_scores.setdefault(sec, []).append(r.combined_score)
    out: dict[str, str] = {}
    for sec, scores in sector_scores.items():
        avg = sum(scores) / len(scores)
        out[sec] = "bullish" if avg >= 60 else "bearish" if avg <= 42 else "neutral"
    return out


@router.get("/scan")
async def market_pulse_scan(
    current_user: CurrentUser,
    market_data: MarketDataDep,
    ai_client: AIDep,
    buy_count: int = Query(default=10, ge=3, le=20),
    sell_count: int = Query(default=5, ge=1, le=10),
    sector: str = Query(default="all"),
) -> dict:
    # Step 1 — quick scan full universe
    universe = [s for s in NIFTY_500 if sector == "all" or SYMBOL_SECTOR.get(s) == sector]
    all_results = await scan(universe=universe, filter_type="both", limit=len(universe))

    # Market overview
    bullish = sum(1 for r in all_results if r.combined_score >= 62)
    bearish = sum(1 for r in all_results if r.combined_score <= 40)
    neutral = len(all_results) - bullish - bearish
    total = len(all_results) or 1

    overview = MarketOverview(
        scanned=len(all_results),
        bullish=bullish,
        bearish=bearish,
        neutral=neutral,
        bullish_pct=round(bullish / total * 100, 1),
        bearish_pct=round(bearish / total * 100, 1),
        sector_sentiment=_sector_sentiment(all_results),
    )

    # Step 2 — pick top candidates for AI deep analysis
    buy_candidates = sorted(all_results, key=lambda r: -r.combined_score)[: buy_count * 2]
    sell_candidates = sorted(all_results, key=lambda r: r.combined_score)[: sell_count * 2]

    # Step 3 — parallel AI enrichment
    buy_enriched_raw = await asyncio.gather(
        *[_enrich_with_ai(r, market_data, ai_client) for r in buy_candidates]
    )
    sell_enriched_raw = await asyncio.gather(
        *[_enrich_with_ai(r, market_data, ai_client) for r in sell_candidates]
    )

    buy_picks = [c for c in buy_enriched_raw if c and c.signal in ("BUY", "HOLD")][:buy_count]
    sell_picks = [c for c in sell_enriched_raw if c and c.signal in ("SELL", "HOLD")][:sell_count]

    def _card_dict(c: PulseCard) -> dict:
        d = asdict(c)
        return d

    return {
        "overview": asdict(overview),
        "buy_picks": [_card_dict(c) for c in buy_picks],
        "sell_picks": [_card_dict(c) for c in sell_picks],
    }


@router.get("/sectors")
async def list_sectors(current_user: CurrentUser) -> list[str]:
    from app.infra.scanner.universe import SECTORS

    return list(SECTORS.keys())

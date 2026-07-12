"""My Trading Dashboard: a single AI-Strength-ranked view across every
tracked MCX contract (NG + Metals) -- a combined heat map + ranked table,
instead of checking the separate NG and Metals pages one at a time.

AI Strength/verdict come from McxScoreCacheRepository (refreshed every 5
min by the existing mcx_signal_check / mcx_metals_signal_check scheduler
jobs) rather than recomputed live here -- recomputing NG-AI Pro's full
score (candles + yfinance correlation + news) for 24 contracts x 2
directions on every page load/poll would take 30-90s+ and hammer the
Kite/yfinance APIs for no benefit over a 5-min-old rank.

Predicted prices (1m/15m/30m/1h) are likewise read from whatever the 5-min
mcx_prediction_check / mcx_metals_prediction_check jobs already generated
(McxPredictionRepository.get_soonest_pending), not recomputed live --
get_prediction()/get_metal_prediction() each do a live Kite historical-
candle fetch, and Kite's historical-data endpoint is rate-limited hard
enough (~3 req/s) that even just the top 10 contracts x 4 periods (40
calls) took 20s+ end to end in testing. A plain Mongo read has none of
that cost.

Only LTP is genuinely live here (get_quote()/get_metal_quote(), Kite's
live-quote endpoint, not the throttled historical one) -- and only for
contracts that already have a cached score, not all 24 tracked ones, since
an uncached contract can never make the ranked list anyway.
"""

from __future__ import annotations

import asyncio

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.infra.db.repositories.mcx_score_cache_repo import McxScoreCacheRepository
from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS, get_metal_quote
from app.services.mcx_service import TRACKED_MCX_CONTRACTS, get_quote, ist_now

PREDICTION_PERIODS = ("1m", "15m", "30m", "1h")

_DISPLAY_NAMES: dict[str, str] = {
    "NG": "Natural Gas", "NGMINI": "Natural Gas Mini",
    "NG_AUG": "Natural Gas (Aug)", "NG_SEP": "Natural Gas (Sep)",
    "NG_OCT": "Natural Gas (Oct)", "NG_NOV": "Natural Gas (Nov)",
    "NG_DEC": "Natural Gas (Dec)",
    "ALUMINIUM": "Aluminium", "ALUMINI": "Aluminium Mini",
    "COPPER": "Copper",
    "LEAD": "Lead", "LEADMINI": "Lead Mini",
    "NICKEL": "Nickel",
    "ZINC": "Zinc", "ZINCMINI": "Zinc Mini",
    "GOLD": "Gold", "GOLDMINI": "Gold Mini", "GOLDTEN": "Gold (10g)",
    "GOLDGUINEA": "Gold Guinea", "GOLDPETAL": "Gold Petal",
    "SILVER": "Silver", "SILVERMINI": "Silver Mini",
    "SILVERMICRO": "Silver Micro", "SILVER100": "Silver (100)",
}

# Emoji per commodity family, matched by code prefix -- purely decorative,
# same spirit as the heat-map mockup this page is based on.
_FAMILY_ICONS: dict[str, str] = {
    "NG": "⛽", "GOLD": "🥇", "SILVER": "🥈", "COPPER": "🟠",
    "ALUMINIUM": "⚙️", "LEAD": "⚙️", "ZINC": "🧪", "NICKEL": "⚪",
}
_FAMILY_PREFIXES = ("NG", "GOLD", "SILVER", "COPPER", "ALUMINIUM", "LEAD", "ZINC", "NICKEL")


def _icon_for(contract: str) -> str:
    for prefix in _FAMILY_PREFIXES:
        if contract.startswith(prefix):
            return _FAMILY_ICONS[prefix]
    return "📦"


# Kite's live-quote endpoint rate-limits at a few requests/second (seen
# live as "Too many requests" -> stale-cache fallback once >~5 quote calls
# land at the same instant). Every other caller in this codebase only ever
# fetches one contract's quote at a time, so this never mattered before --
# this dashboard is the first caller requesting up to ~24 at once. Capping
# concurrency queues politely instead of tripping the throttle.
_QUOTE_CONCURRENCY = asyncio.Semaphore(3)


async def _quote_or_none(user_id: str, contract: str, is_metal: bool) -> dict | None:
    async with _QUOTE_CONCURRENCY:
        try:
            if is_metal:
                return await get_metal_quote(user_id, contract)
            return await get_quote(user_id, contract)
        except Exception:
            return None


async def _predictions_for(
    user_id: str, contract: str, repo: McxPredictionRepository
) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for period in PREDICTION_PERIODS:
        try:
            doc = await repo.get_soonest_pending(user_id, contract, period)
            out[period] = doc["predicted_close"] if doc else None
        except Exception:
            out[period] = None
    return out


async def get_ranked_dashboard(user_id: str, limit: int = 10) -> dict:
    score_cache = McxScoreCacheRepository()
    cached_scores = await score_cache.get_all_for_user(user_id)

    # Best-scoring direction per contract -- e.g. if SELL scores higher than
    # BUY for a given contract right now, that's the direction/verdict shown.
    best_by_contract: dict[str, dict] = {}
    for row in cached_scores:
        c = row["contract"]
        if c not in best_by_contract or row["score_pct"] > best_by_contract[c]["score_pct"]:
            best_by_contract[c] = row

    is_metal_by_contract = {c: False for c in TRACKED_MCX_CONTRACTS}
    is_metal_by_contract.update({c: True for c in TRACKED_MCX_METALS_CONTRACTS})

    # Only fetch a live quote for contracts that already have a cached
    # score -- an uncached one (signal-check job hasn't reached it yet)
    # can never make the ranked list anyway, so a quote for it is wasted.
    scored_contracts = [
        (c, is_metal_by_contract[c]) for c in best_by_contract if c in is_metal_by_contract
    ]
    quotes = await asyncio.gather(
        *[_quote_or_none(user_id, c, is_metal) for c, is_metal in scored_contracts]
    )

    rows = []
    for (contract, is_metal), quote in zip(scored_contracts, quotes, strict=True):
        if quote is None:
            continue
        score = best_by_contract[contract]
        rows.append(
            {
                "contract": contract,
                "name": _DISPLAY_NAMES.get(contract, contract),
                "icon": _icon_for(contract),
                "market": "metals" if is_metal else "ng",
                "tradingsymbol": quote.get("tradingsymbol"),
                "ltp": quote.get("last_price"),
                "change_pct": quote.get("change_pct"),
                "ai_score_pct": score["score_pct"],
                "direction": score["direction"],
                "verdict": score["verdict"],
                "score_updated_at": score["updated_at"].isoformat(),
            }
        )

    rows.sort(key=lambda r: r["ai_score_pct"], reverse=True)
    top = rows[:limit]

    pred_repo = McxPredictionRepository()
    predictions = await asyncio.gather(
        *[_predictions_for(user_id, r["contract"], pred_repo) for r in top]
    )
    for row, preds in zip(top, predictions, strict=True):
        row["predicted"] = preds

    return {
        "generated_at": ist_now().isoformat(),
        "ranked": top,
        "total_tracked": len(rows),
        "total_contracts": len(is_metal_by_contract),
    }

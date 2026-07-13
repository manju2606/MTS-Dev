"""Reusable end-of-day trading summary: a crisp, plain-language recap of one
contract's day plus the structured numbers behind it, built entirely from
data this app already computes (the daily dashboard snapshot + range-stats +
the last stored daily trend classification) -- no new live Kite calls.
Persisted to a history collection so today's summary can be compared against
yesterday's tomorrow, the same way the AI prediction accuracy trail checks
whether yesterday's forecast held up.

One function shared by NG and every metals contract: build_and_save_snapshot
(mcx_dashboard_snapshot_service.py) and build_and_save_metal_snapshot
(mcx_metals_dashboard_snapshot_service.py) already return an identical
shape, as do get_range_stats (mcx_service.py) and get_metal_range_stats
(mcx_metals_service.py) -- so build_day_summary below doesn't know or care
which commodity it's summarizing.

Note on 52-week high/low: MCX contracts are monthly-expiring futures (the
current front-month instrument didn't exist a year ago -- see
mcx_prediction_service.py's MIN_CANDLES_CALENDAR comment for the same
constraint), so a true 52-week figure doesn't cleanly apply. Week/month
high-low (already computed by get_range_stats/get_metal_range_stats) is the
closest honest equivalent and is what this uses instead of inventing one.
"""

from __future__ import annotations

from app.infra.db.repositories.mcx_day_summary_repo import McxDaySummaryRepository
from app.infra.db.repositories.mcx_trend_repo import McxTrendRepository
from app.services.mcx_service import ist_now

# Below this, an open-vs-prev-close gap is just noise, not worth a sentence.
GAP_NOTE_THRESHOLD_PCT = 0.5


def _fmt_pct(v: float) -> str:
    return f"{'+' if v >= 0 else ''}{v:.2f}%"


def _new_extreme_note(close: float, high: float, low: float, label: str) -> str | None:
    """"new week high" / "new month low" / etc, or None -- compares the
    close against a range that already includes today (see get_range_stats),
    so an exact match means today's close set (or tied) that extreme."""
    if close >= high:
        return f"new {label} high"
    if close <= low:
        return f"new {label} low"
    return None


def build_day_summary(
    contract: str,
    tradingsymbol: str,
    snapshot: dict,
    range_stats: dict,
    trend: dict | None,
) -> dict:
    """Pure function: given today's already-computed snapshot + range-stats
    (+ optional latest daily trend classification), returns the structured
    summary dict (including the narrative sentence). No I/O and no
    NG-vs-metals branching, so it's trivially reusable and testable."""
    close = snapshot["last_price"]
    prev_close = snapshot["prev_close"]
    change_pct = snapshot["change_pct"]

    direction = trend["direction"] if trend else None
    strength = trend["strength"] if trend else None

    extreme_notes = [
        n
        for n in (
            _new_extreme_note(close, range_stats["week_high"], range_stats["week_low"], "week"),
            _new_extreme_note(close, range_stats["month_high"], range_stats["month_low"], "month"),
        )
        if n
    ]

    gap_pct = round(
        ((snapshot["open"] - prev_close) / prev_close * 100) if prev_close else 0.0, 2
    )
    gap_note = None
    if abs(gap_pct) >= GAP_NOTE_THRESHOLD_PCT:
        gap_note = f"gapped {'up' if gap_pct > 0 else 'down'} {abs(gap_pct):.2f}% at open"

    buy_pct, sell_pct = snapshot["buy_score_pct"], snapshot["sell_score_pct"]
    lean = "BUY" if buy_pct >= sell_pct else "SELL"
    lean_score = max(buy_pct, sell_pct)
    verdict = snapshot["buy_verdict"] if lean == "BUY" else snapshot["sell_verdict"]

    sentence1 = f"{tradingsymbol} closed" + (f" {direction}" if direction else "")
    sentence1 += f" at {close:.2f}, {_fmt_pct(change_pct)} from prev close ({prev_close:.2f})"
    sentence1 += f" — {gap_note}." if gap_note else "."

    if extreme_notes:
        sentence2 = "Made a " + " and ".join(extreme_notes) + "."
    else:
        sentence2 = (
            f"Within its {range_stats['week_low']:.2f}-{range_stats['week_high']:.2f} week range."
        )

    sentence3 = f"AI lean: {lean_score:.0f}% {lean} ({verdict})."
    narrative = " ".join([sentence1, sentence2, sentence3])

    return {
        "contract": contract.upper(),
        "tradingsymbol": tradingsymbol,
        "date": ist_now().date().isoformat(),
        "close": close,
        "open": snapshot["open"],
        "high": snapshot["high"],
        "low": snapshot["low"],
        "prev_close": prev_close,
        "change": snapshot["change"],
        "change_pct": change_pct,
        "volume": snapshot["volume"],
        "oi": snapshot["oi"],
        "day_high": range_stats["day_high"],
        "day_low": range_stats["day_low"],
        "week_high": range_stats["week_high"],
        "week_low": range_stats["week_low"],
        "month_high": range_stats["month_high"],
        "month_low": range_stats["month_low"],
        "trend_direction": direction,
        "trend_strength": strength,
        "ai_lean": lean,
        "ai_score_pct": lean_score,
        "ai_verdict": verdict,
        "gap_pct": gap_pct,
        "new_extremes": extreme_notes,
        "narrative": narrative,
    }


async def build_and_store_day_summary(
    user_id: str, contract: str, snapshot: dict, range_stats: dict
) -> dict:
    """I/O wrapper: pulls the latest stored daily trend classification (if
    any -- reusing whatever the trend-check job already computed, no extra
    live Kite call), builds the summary via the pure function above, and
    persists it to mcx_day_summary_history."""
    trend = await McxTrendRepository().get_latest(user_id, contract, "1D")
    summary = build_day_summary(contract, snapshot["tradingsymbol"], snapshot, range_stats, trend)
    await McxDaySummaryRepository().save_summary(user_id, contract, summary)
    return summary


async def get_day_summary_history(user_id: str, contract: str, days: int = 30) -> list[dict]:
    return await McxDaySummaryRepository().get_recent(user_id, contract, days)

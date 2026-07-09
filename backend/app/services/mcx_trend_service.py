"""MCX multi-timeframe trend ladder + regime-change detection.

Rule-based (no ML, no sentiment/news -- those need external API access this
app doesn't have yet, see mcx_ai_score_service.py's own docstring for the
same reasoning). For each timeframe, classifies BULLISH/BEARISH/NEUTRAL from
EMA alignment + ADX + MACD histogram, then compares against the last stored
snapshot to say whether that trend is STABLE, WEAKENING (about to change),
or JUST_CHANGED (flipped since the last check) -- which is what the alerting
job in the scheduler watches.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.infra.mcx import ng_indicators as ind
from app.services.mcx_service import get_zerodha_broker, ist_now

_INTERVAL_MAP = {
    "1m": "minute",
    "5m": "5minute",
    "15m": "15minute",
    "1h": "60minute",
    "1D": "day",
    "1W": "day",
}
_LOOKBACK_DAYS = {"1m": 2, "5m": 5, "15m": 10, "1h": 30, "1D": 200, "1W": 500}
TIMEFRAMES = ("1m", "5m", "15m", "1h", "1D", "1W")


async def _fetch_candles(broker, instrument_token: int, timeframe: str) -> list[dict]:
    days = _LOOKBACK_DAYS[timeframe]
    to_dt = ist_now()
    from_dt = to_dt - timedelta(days=days)
    candles = await broker.get_historical_candles(
        instrument_token,
        _INTERVAL_MAP[timeframe],
        from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        to_dt.strftime("%Y-%m-%d %H:%M:%S"),
    )
    if timeframe == "1W":
        candles = _resample_weekly(candles)
    return candles


def _resample_weekly(daily_candles: list[dict]) -> list[dict]:
    """Kite has no native weekly interval -- roll up daily candles (ISO week)."""
    weeks: dict[tuple[int, int], list[dict]] = {}
    for c in daily_candles:
        key = c["date"].isocalendar()[:2]  # (year, week)
        weeks.setdefault(key, []).append(c)
    out = []
    for key in sorted(weeks):
        bucket = weeks[key]
        out.append(
            {
                "date": bucket[-1]["date"],
                "open": bucket[0]["open"],
                "high": max(b["high"] for b in bucket),
                "low": min(b["low"] for b in bucket),
                "close": bucket[-1]["close"],
                "volume": sum(b.get("volume", 0) for b in bucket),
                "oi": bucket[-1].get("oi", 0),
            }
        )
    return out


def classify_trend(candles: list[dict]) -> dict:
    """BULLISH/BEARISH/NEUTRAL + a 0-100 strength score for one timeframe's
    candles, from EMA20/50 alignment + ADX + MACD histogram."""
    if len(candles) < 55:
        return {"direction": "UNKNOWN", "strength": 0.0, "reason": f"only {len(candles)} candles"}

    h, low, c = ind.highs(candles), ind.lows(candles), ind.closes(candles)
    price = c[-1]
    ema20, ema50 = ind.ema(c, 20), ind.ema(c, 50)
    adx_val = ind.adx(h, low, c)
    macd_val = ind.macd(c)

    if ema20 is None or ema50 is None:
        return {"direction": "UNKNOWN", "strength": 0.0, "reason": "not enough data for EMA50"}

    bullish_align = price > ema20 > ema50
    bearish_align = price < ema20 < ema50
    direction = "BULLISH" if bullish_align else "BEARISH" if bearish_align else "NEUTRAL"

    adx_component = min(adx_val or 0.0, 50.0)  # 0-50
    macd_component = 15.0 if macd_val and ((macd_val[2] > 0) == bullish_align) else 0.0
    align_component = 20.0 if direction != "NEUTRAL" else 0.0
    strength = round(min(100.0, adx_component + macd_component + align_component), 1)

    return {
        "direction": direction,
        "strength": strength,
        "price": price,
        "ema20": round(ema20, 4),
        "ema50": round(ema50, 4),
        "adx": adx_val,
        "macd_histogram": macd_val[2] if macd_val else None,
    }


def _change_state(current: dict, previous: dict | None) -> str:
    """STABLE | WEAKENING | JUST_CHANGED, comparing against the last stored
    snapshot for this (user, contract, timeframe)."""
    if previous is None or previous.get("direction") in (None, "UNKNOWN"):
        return "STABLE"
    if current["direction"] == "UNKNOWN":
        return "STABLE"
    if current["direction"] != previous["direction"]:
        return "JUST_CHANGED"
    # Same direction, but losing conviction -- a meaningful strength drop is
    # an early warning the regime may be about to flip.
    if current["strength"] < previous.get("strength", 0) - 15:
        return "WEAKENING"
    return "STABLE"


async def compute_trend_ladder(user_id: str, contract: str = "NG") -> dict:
    """Live trend classification across all TIMEFRAMES for one contract --
    no persistence/change-detection here (see compute_and_store_snapshot for
    that, used by the scheduled alerting job)."""
    from app.services.mcx_service import resolve_contract as resolve_mcx_contract

    broker = await get_zerodha_broker(user_id)
    contract_info = await resolve_mcx_contract(broker, contract)
    token = contract_info["instrument_token"]

    ladder = {}
    for tf in TIMEFRAMES:
        try:
            candles = await _fetch_candles(broker, token, tf)
            ladder[tf] = classify_trend(candles)
        except Exception as exc:
            ladder[tf] = {"direction": "UNKNOWN", "strength": 0.0, "reason": str(exc)}

    return {
        "contract": contract.upper(),
        "tradingsymbol": contract_info["tradingsymbol"],
        "computed_at": datetime.utcnow().isoformat(),
        "ladder": ladder,
    }


async def compute_and_store_snapshot(user_id: str, contract: str) -> dict:
    """Used by the scheduler: computes the ladder, compares each timeframe
    against its last stored snapshot, persists the new state, and returns
    which timeframes changed state (for the alerting job to act on)."""
    from app.infra.db.repositories.mcx_trend_repo import McxTrendRepository

    repo = McxTrendRepository()
    result = await compute_trend_ladder(user_id, contract)

    changes = []
    for tf, current in result["ladder"].items():
        if current["direction"] == "UNKNOWN":
            continue
        previous = await repo.get_latest(user_id, contract, tf)
        state = _change_state(current, previous)
        current["change_state"] = state
        await repo.save_snapshot(user_id, contract, tf, current)
        if state in ("JUST_CHANGED", "WEAKENING"):
            changes.append(
                {
                    "timeframe": tf,
                    "state": state,
                    "direction": current["direction"],
                    "strength": current["strength"],
                    "previous_direction": previous.get("direction") if previous else None,
                }
            )

    result["changes"] = changes
    if changes:
        await _send_trend_alert(user_id, result["contract"], result["tradingsymbol"], changes)
    return result


async def _send_trend_alert(
    user_id: str, contract: str, tradingsymbol: str, changes: list[dict]
) -> None:
    """Email + in-app notification when a timeframe's trend just changed or
    is weakening -- the two channels this app actually has (see
    mcx_trend_report.py's docstring context: no SMS infra, scoped out)."""
    import structlog

    log = structlog.get_logger()

    summary = ", ".join(f"{c['timeframe']} {c['state'].replace('_', ' ').lower()}" for c in changes)

    try:
        from app.infra.notifications.push import fire as notif_fire

        notif_fire(
            user_id,
            "mcx.trend_change",
            f"MCX {contract} trend alert",
            summary,
            "/mcx",
        )
    except Exception as exc:
        log.warning("mcx.trend_alert.notif_failed", error=str(exc))

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email
        from app.infra.email.mcx_trend_report import mcx_trend_alert_html

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = mcx_trend_alert_html(contract, tradingsymbol, changes)
        subject = f"MCX {contract} Trend Alert — {summary}"
        await send_email(to=user.email, subject=subject, html=html)
        log.info("mcx.trend_alert.sent", user_id=user_id, contract=contract, changes=len(changes))
    except Exception as exc:
        log.warning("mcx.trend_alert.email_failed", error=str(exc))

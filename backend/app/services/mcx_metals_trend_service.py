"""MCX Base & Precious Metals multi-timeframe trend ladder + regime-change
detection -- sibling to mcx_trend_service.py (Natural Gas), same rule-based
EMA/ADX/MACD classification (reused unchanged from app/infra/mcx/ng_indicators.py,
which despite its filename is fully generic OHLCV math). Persists to the
same McxTrendRepository as NG, just keyed by a metals contract code.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.services.mcx_service import get_zerodha_broker, ist_now
from app.services.mcx_trend_service import (
    TIMEFRAMES,
    _change_state,
    _resample_weekly,
    classify_trend,
)

_INTERVAL_MAP = {
    "1m": "minute",
    "5m": "5minute",
    "15m": "15minute",
    "1h": "60minute",
    "1D": "day",
    "1W": "day",
}
_LOOKBACK_DAYS = {"1m": 2, "5m": 5, "15m": 10, "1h": 30, "1D": 200, "1W": 500}


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


async def compute_metal_trend_ladder(user_id: str, contract: str = "GOLD") -> dict:
    """Live trend classification across all TIMEFRAMES for one metals
    contract -- no persistence/change-detection here (see
    compute_and_store_metal_snapshot for that)."""
    from app.services.mcx_metals_service import resolve_metal_contract

    broker = await get_zerodha_broker(user_id)
    contract_info = await resolve_metal_contract(broker, contract)
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


async def compute_and_store_metal_snapshot(user_id: str, contract: str) -> dict:
    """Used by the scheduler: computes the ladder, compares each timeframe
    against its last stored snapshot, persists the new state, and returns
    which timeframes changed state."""
    from app.infra.db.repositories.mcx_trend_repo import McxTrendRepository

    repo = McxTrendRepository()
    result = await compute_metal_trend_ladder(user_id, contract)

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
        await _send_metal_trend_alert(user_id, result["contract"], result["tradingsymbol"], changes)
    return result


async def _send_metal_trend_alert(
    user_id: str, contract: str, tradingsymbol: str, changes: list[dict]
) -> None:
    """Email + in-app notification when a timeframe's trend just changed or
    is weakening -- same two channels as NG's trend alert."""
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
            "/mcx/metals",
        )
    except Exception as exc:
        log.warning("mcx_metals.trend_alert.notif_failed", error=str(exc))

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
        log.info(
            "mcx_metals.trend_alert.sent", user_id=user_id, contract=contract, changes=len(changes)
        )
    except Exception as exc:
        log.warning("mcx_metals.trend_alert.email_failed", error=str(exc))

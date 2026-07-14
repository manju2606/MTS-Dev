"""MCX day/week extreme-proximity alerts: emails + in-app notifies when a
tracked contract's live price comes within EXTREME_PROXIMITY_PCT of its own
day or week high/low -- built entirely from the range-stats every NG/Metals
chart already shows (get_range_stats/get_metal_range_stats), no new data
source. One shared check function for both NG and Metals (market selects
which quote/range-stats fetchers to call), same reuse pattern as
mcx_day_summary_service.py's build_day_summary.

Edge-triggered, not level-triggered: an alert fires once when price first
comes within the threshold, then only fires again once price has moved back
outside the threshold and approaches again (see McxExtremeAlertRepository) --
otherwise a price sitting right at its day high for an hour would re-email
every 15-min check.
"""

from __future__ import annotations

from app.infra.db.repositories.mcx_extreme_alert_repo import McxExtremeAlertRepository

EXTREME_PROXIMITY_PCT = 0.5

# Quick kill switch, mirroring mcx_trend_service.TREND_ALERT_EMAILS_ENABLED --
# flip to False if this ever needs pausing without deciding anything else.
EXTREME_ALERT_EMAILS_ENABLED = True

_LEVELS: tuple[tuple[str, str], ...] = (
    ("day_high", "Day High"),
    ("day_low", "Day Low"),
    ("week_high", "Week High"),
    ("week_low", "Week Low"),
)


def _distance_pct(ltp: float, level: float) -> float:
    if not level:
        return 100.0
    return abs(ltp - level) / level * 100


async def _check_levels(
    user_id: str, contract: str, ltp: float, range_stats: dict, repo: McxExtremeAlertRepository
) -> list[dict]:
    """Checks all 4 levels, updates armed/re-armed state in Mongo, and
    returns only the levels that just newly fired (for the caller to email/
    notify about) -- an empty list means nothing new to alert on this check,
    whether because nothing's near or because it's still armed from an
    already-alerted approach."""
    fired = []
    for level_key, level_label in _LEVELS:
        level_value = range_stats[level_key]
        near = _distance_pct(ltp, level_value) <= EXTREME_PROXIMITY_PCT
        already_armed = await repo.is_armed(user_id, contract, level_key)
        if near and not already_armed:
            fired.append(
                {
                    "level_type": level_key,
                    "level_label": level_label,
                    "level_value": level_value,
                    "ltp": ltp,
                }
            )
            await repo.set_armed(user_id, contract, level_key, True)
        elif not near and already_armed:
            await repo.set_armed(user_id, contract, level_key, False)
    return fired


async def check_and_alert_extreme_proximity(
    user_id: str, contract: str, market: str, repo: McxExtremeAlertRepository
) -> bool:
    """market: "ng" or "metals" -- picks the matching quote/range-stats
    fetchers. Returns True if a new near-extreme alert fired (for the
    scheduler's own logging, not required by callers otherwise)."""
    if market == "metals":
        from app.services.mcx_metals_service import get_metal_quote, get_metal_range_stats

        quote = await get_metal_quote(user_id, contract)
        range_stats = await get_metal_range_stats(user_id, contract)
    else:
        from app.services.mcx_service import get_quote, get_range_stats

        quote = await get_quote(user_id, contract)
        range_stats = await get_range_stats(user_id, contract)

    fired = await _check_levels(user_id, contract, quote["last_price"], range_stats, repo)
    if not fired:
        return False

    await _send_extreme_alert(user_id, contract, quote["tradingsymbol"], market, fired)
    return True


async def _send_extreme_alert(
    user_id: str, contract: str, tradingsymbol: str, market: str, events: list[dict]
) -> None:
    import structlog

    log = structlog.get_logger()
    summary = ", ".join(f"{e['level_label']} ({e['level_value']:.2f})" for e in events)
    link = "/mcx/metals" if market == "metals" else "/mcx"

    try:
        from app.infra.notifications.push import fire as notif_fire

        notif_fire(
            user_id,
            "mcx.extreme_alert",
            f"MCX {contract} near {summary}",
            f"LTP {events[0]['ltp']:.2f}",
            link,
        )
    except Exception as exc:
        log.warning("mcx.extreme_alert.notif_failed", error=str(exc))

    if not EXTREME_ALERT_EMAILS_ENABLED:
        return

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email
        from app.infra.email.mcx_extreme_alert_report import mcx_extreme_alert_html

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = mcx_extreme_alert_html(contract, tradingsymbol, events, EXTREME_PROXIMITY_PCT)
        subject = f"MCX {contract} Near {summary}"
        await send_email(to=user.email, subject=subject, html=html)
        log.info(
            "mcx.extreme_alert.sent", user_id=user_id, contract=contract, events=len(events)
        )
    except Exception as exc:
        log.warning("mcx.extreme_alert.email_failed", error=str(exc))

"""Daily snapshot of the NG Dashboard's full state -- LTP, OHLCV/OI, and
both directions' AI score/verdict -- so the Dashboard tab has a persistent
Day/Week/Month history instead of only ever showing "right now" (see
app/infra/db/repositories/mcx_dashboard_snapshot_repo.py). Weekly/monthly
views are aggregated client-side from these daily rows, not stored
separately -- consistent with how the prediction accuracy archive works
(app/services/mcx_prediction_service.get_archived_day).
"""

from __future__ import annotations

from datetime import timedelta

from app.infra.db.repositories.mcx_dashboard_snapshot_repo import McxDashboardSnapshotRepository
from app.services.mcx_ai_score_service import compute_ng_ai_score
from app.services.mcx_service import get_quote, ist_now

SNAPSHOT_CAPITAL = 100_000.0


async def build_and_save_snapshot(
    user_id: str, contract: str, repo: McxDashboardSnapshotRepository
) -> dict:
    quote = await get_quote(user_id, contract)
    buy_score = await compute_ng_ai_score(user_id, "BUY", SNAPSHOT_CAPITAL, contract)
    sell_score = await compute_ng_ai_score(user_id, "SELL", SNAPSHOT_CAPITAL, contract)

    date_str = ist_now().date().isoformat()
    snapshot = {
        "tradingsymbol": quote["tradingsymbol"],
        "last_price": quote["last_price"],
        "open": quote["open"],
        "high": quote["high"],
        "low": quote["low"],
        "prev_close": quote["prev_close"],
        "change": quote["change"],
        "change_pct": quote["change_pct"],
        "volume": quote["volume"],
        "oi": quote["oi"],
        "oi_day_high": quote["oi_day_high"],
        "oi_day_low": quote["oi_day_low"],
        "buy_score_pct": buy_score["score_pct"],
        "buy_verdict": buy_score["verdict"],
        "sell_score_pct": sell_score["score_pct"],
        "sell_verdict": sell_score["verdict"],
    }
    await repo.save_snapshot(user_id, contract, date_str, snapshot)
    return snapshot


async def get_snapshot_range(
    user_id: str, contract: str, days: int, repo: McxDashboardSnapshotRepository
) -> list[dict]:
    end = ist_now().date()
    start = end - timedelta(days=days)
    return await repo.get_range(user_id, contract, start.isoformat(), end.isoformat())

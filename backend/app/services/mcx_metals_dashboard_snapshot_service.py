"""Daily snapshot of an MCX metals contract's full state -- sibling to
mcx_dashboard_snapshot_service.py (Natural Gas). Only build_and_save_snapshot()
calls commodity-specific quote/score fetches; get_snapshot_range() is a pure
Mongo range query and is imported and reused unchanged.
"""

from __future__ import annotations

from app.infra.db.repositories.mcx_dashboard_snapshot_repo import McxDashboardSnapshotRepository
from app.services.mcx_dashboard_snapshot_service import (
    SNAPSHOT_CAPITAL,
)
from app.services.mcx_dashboard_snapshot_service import (
    get_snapshot_range as get_metal_snapshot_range,
)
from app.services.mcx_metals_ai_score_service import compute_metal_ai_score
from app.services.mcx_metals_service import get_metal_quote
from app.services.mcx_service import ist_now

__all__ = ["build_and_save_metal_snapshot", "get_metal_snapshot_range"]


async def build_and_save_metal_snapshot(
    user_id: str, contract: str, repo: McxDashboardSnapshotRepository
) -> dict:
    quote = await get_metal_quote(user_id, contract)
    buy_score = await compute_metal_ai_score(user_id, "BUY", SNAPSHOT_CAPITAL, contract)
    sell_score = await compute_metal_ai_score(user_id, "SELL", SNAPSHOT_CAPITAL, contract)

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

"""Backtest report for the NG-AI Pro / Metals AI signal scorer (see
mcx_ai_score_service.py, mcx_metals_ai_score_service.py) against its own
logged signal outcomes (mcx_trade_signals) -- answers "is the rule-based
scorer actually working" across a set of trailing windows, split by NG vs
Metals, before considering any ML upgrade.

This evaluates the scorer itself (every TRADE-tier signal it ever logged,
across all users), not one user's trading performance -- see
McxSignalRepository.list_closed_signals_since.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
from app.services.mcx_metals_service import TRACKED_MCX_METALS_CONTRACTS

# label -> lookback days. 12m and 1y are intentionally both included (as
# requested) even though they cover the same window -- kept as distinct
# labels rather than deduplicated so the report always echoes back exactly
# the windows asked for.
BACKTEST_WINDOWS: dict[str, int] = {
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "12m": 365,
    "1y": 365,
    "3y": 365 * 3,
    "5y": 365 * 5,
}

_METALS_SET = set(TRACKED_MCX_METALS_CONTRACTS)


def _group(contract: str) -> str:
    """"ng" for any NG-family code (front month, mini, or a specific
    NG_<MON> expiry -- past, current, or future; which months are actively
    *tracked* by the scheduler changes every month, see
    get_tracked_mcx_contracts, but a backtest spans years of already-logged
    signals, so classification here matches by shape, not by today's
    tracked-months list), "metals" for a currently-tracked metals contract,
    else "other"."""
    c = contract.upper()
    if c in _METALS_SET:
        return "metals"
    if c == "NG" or c == "NGMINI" or c.startswith("NG_"):
        return "ng"
    return "other"


def _stats_for(signals: list[dict]) -> dict:
    resolved = [s for s in signals if s.get("result") in ("WIN", "LOSS")]
    wins = [s for s in resolved if s["result"] == "WIN"]
    losses = [s for s in resolved if s["result"] == "LOSS"]
    expired = [s for s in signals if s.get("result") == "EXPIRED"]

    win_pnl = sum(float(s["pnl"]) for s in wins if s.get("pnl") is not None)
    loss_pnl = sum(float(s["pnl"]) for s in losses if s.get("pnl") is not None)
    all_pnl = [float(s["pnl"]) for s in signals if s.get("pnl") is not None]
    days = [float(s["days_to_close"]) for s in signals if s.get("days_to_close") is not None]

    return {
        "total_signals": len(signals),
        "resolved": len(resolved),
        "wins": len(wins),
        "losses": len(losses),
        "expired": len(expired),
        "win_rate_pct": round(len(wins) / len(resolved) * 100, 1) if resolved else None,
        "total_pnl": round(sum(all_pnl), 2) if all_pnl else None,
        "avg_pnl": round(sum(all_pnl) / len(all_pnl), 2) if all_pnl else None,
        # profit factor: gross profit / gross loss magnitude. None (not inf)
        # when there's no losing pnl to divide by, since "infinite" isn't a
        # meaningful number to hand back over an API.
        "profit_factor": round(win_pnl / abs(loss_pnl), 2) if loss_pnl < 0 else None,
        "avg_days_to_close": round(sum(days) / len(days), 2) if days else None,
    }


async def get_backtest_report(
    repo: McxSignalRepository, windows: dict[str, int] | None = None
) -> dict:
    """Backtest stats (overall + NG-only + Metals-only) for each requested
    window. `windows` defaults to BACKTEST_WINDOWS; pass a subset for a
    cheaper/narrower report."""
    windows = windows or BACKTEST_WINDOWS
    now = datetime.utcnow()

    report: dict[str, dict] = {}
    for label, days in windows.items():
        since = now - timedelta(days=days)
        signals = await repo.list_closed_signals_since(since)

        ng_signals = [s for s in signals if _group(s.get("contract", "")) == "ng"]
        metals_signals = [s for s in signals if _group(s.get("contract", "")) == "metals"]

        report[label] = {
            "window_days": days,
            "since": since.isoformat(),
            "overall": _stats_for(signals),
            "ng": _stats_for(ng_signals),
            "metals": _stats_for(metals_signals),
        }

    return report

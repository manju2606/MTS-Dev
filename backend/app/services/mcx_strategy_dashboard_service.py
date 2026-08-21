"""MTS Strategy Dashboard: a My-Trading-Dashboard-style combined view across
just the three MTS Strategy engines built this session -- Gold Guinea, Silver100,
and NG Mini (mcx_gold_strategy_service.py / mcx_silver_strategy_service.py /
mcx_ng_strategy_service.py) -- as opposed to my-trading-dashboard's 24-contract
NG-AI Pro / Metals-AI Pro sweep.

Unlike my-trading-dashboard (which reads a 5-min-refreshed score cache because
recomputing 24 contracts x 2 directions live would take 30-90s+), this scores
all three contracts live on every request: only 3 contracts x 2 directions x
~4 history calls is small enough to stay well under the API latency target.
All three now also have a background scheduler job (scheduler.py's
_run_mcx_gold_strategy_check / _run_mcx_silver_strategy_check /
_run_mcx_ng_strategy_check), but those only log signals + fire alerts --
they don't cache scores anywhere this dashboard could read from, hence the
live recompute here too.

can_trade/blocked_reasons on each row come from the same can_generate_new_signal
gate the scheduler job checks before logging a signal -- the score/signal_label
are a raw live read regardless of that gate, so a tile showing "STRONG BUY"
with can_trade=False means an alert will NOT fire for it (daily trade cap,
consecutive-loss pause, or expiry-protection window already blocking new
signals for that contract today).

Also unlike my-trading-dashboard's data_user_id resolution (shared connected
account via session_store.get_market_data_user_id()), this stays scoped to
current_user.id throughout, same as every other MTS Strategy endpoint
(mcx_gold_strategy.py/mcx_silver_strategy.py/mcx_ng_strategy.py's routers) --
these signals are per-user by nature, per those modules' own docstrings.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.services.mcx_service import ist_now

_ScoreFn = Callable[..., Awaitable[dict]]
_QuoteFn = Callable[[str, str], Awaitable[dict]]
_RiskFn = Callable[..., Awaitable[tuple[bool, list[str]]]]


async def _gold_quote(user_id: str, contract: str) -> dict:
    from app.services.mcx_metals_service import get_metal_quote

    return await get_metal_quote(user_id, contract)


async def _ng_quote(user_id: str, contract: str) -> dict:
    from app.services.mcx_service import get_quote

    return await get_quote(user_id, contract)


def _instruments() -> list[dict[str, Any]]:
    from app.services.mcx_gold_strategy_service import can_generate_new_signal as gold_can_trade
    from app.services.mcx_gold_strategy_service import compute_gold_strategy_score
    from app.services.mcx_ng_strategy_service import can_generate_new_signal as ng_can_trade
    from app.services.mcx_ng_strategy_service import compute_ng_strategy_score
    from app.services.mcx_silver_strategy_service import can_generate_new_signal as silver_can_trade
    from app.services.mcx_silver_strategy_service import compute_silver_strategy_score

    return [
        {
            "contract": "GOLDGUINEA", "name": "Gold Guinea", "icon": "🥇", "market": "metals",
            "compute": compute_gold_strategy_score, "quote": _gold_quote,
            "can_trade": gold_can_trade,
        },
        {
            "contract": "SILVER100", "name": "Silver100", "icon": "🥈", "market": "metals",
            "compute": compute_silver_strategy_score, "quote": _gold_quote,
            "can_trade": silver_can_trade,
        },
        {
            "contract": "NGMINI", "name": "NG Mini", "icon": "⛽", "market": "ng",
            "compute": compute_ng_strategy_score, "quote": _ng_quote,
            "can_trade": ng_can_trade,
        },
    ]


async def _best_score(
    user_id: str, contract: str, compute: _ScoreFn, capital: float, account_risk_pct: float
) -> dict | None:
    """Scores both directions (same "best-scoring direction wins" rule
    my-trading-dashboard uses) and returns whichever is higher -- None if
    neither direction has enough candle history yet (compute raises
    ValueError in that case, same convention as compute_metal_ai_score)."""
    results: dict[str, dict] = {}
    for direction in ("BUY", "SELL"):
        try:
            results[direction] = await compute(
                user_id, direction, contract, capital, account_risk_pct
            )
        except Exception:
            continue
    if not results:
        return None
    best_direction = max(results, key=lambda d: results[d]["score_pct"])
    return results[best_direction]


async def _can_trade_or_none(
    can_trade_fn: _RiskFn, user_id: str, contract: str, repo: Any
) -> tuple[bool, list[str]] | None:
    try:
        return await can_trade_fn(user_id, contract, repo)
    except Exception:
        return None


async def _row_for(
    user_id: str, inst: dict[str, Any], capital: float, account_risk_pct: float, repo: Any
) -> dict[str, Any]:
    score, quote, risk = await asyncio.gather(
        _best_score(user_id, inst["contract"], inst["compute"], capital, account_risk_pct),
        _quote_or_none(inst["quote"], user_id, inst["contract"]),
        _can_trade_or_none(inst["can_trade"], user_id, inst["contract"], repo),
    )
    # can_trade=None (rather than True) when the check itself failed, so the
    # frontend can tell "confirmed not blocked" apart from "couldn't check"
    # instead of defaulting to a false "all clear".
    can_trade, blocked_reasons = risk if risk else (None, [])

    base = {
        "contract": inst["contract"],
        "name": inst["name"],
        "icon": inst["icon"],
        "market": inst["market"],
        "ltp": quote.get("last_price") if quote else None,
        "change_pct": quote.get("change_pct") if quote else None,
        # Whether the background scheduler job is actually allowed to log a
        # signal (and therefore alert) for this contract right now -- the
        # score/signal_label below are the raw live read regardless of risk
        # state, so a tile can show "STRONG BUY" while can_trade is False
        # (e.g. daily trade cap or expiry-protection window hit). Without
        # this, the dashboard looks like a live actionable signal even when
        # the alert system has correctly refused to fire on it.
        "can_trade": can_trade,
        "blocked_reasons": blocked_reasons,
    }
    if score is None:
        return {
            **base,
            "available": False,
            "score_pct": None,
            "verdict": None,
            "direction": None,
            "signal_label": None,
            "entry_price": None,
            "stop_loss": None,
            "target_1": None,
            "target_2": None,
            "risk_reward": None,
            "updated_at": ist_now().isoformat(),
        }
    entry = score["entry"]
    return {
        **base,
        "ltp": base["ltp"] if base["ltp"] is not None else score["price"],
        "available": True,
        "score_pct": score["score_pct"],
        "verdict": score["verdict"],
        "direction": score["direction"],
        # "BUY" | "STRONG BUY" | "SELL" | "STRONG SELL" | "WATCH" | "NO TRADE" --
        # same label the individual strategy panels already show, computed
        # once by compute_*_strategy_score rather than re-derived here.
        "signal_label": score["signal_label"],
        "entry_price": entry["entry_price"],
        "stop_loss": entry["stop_loss"],
        "target_1": entry["target_1"],
        "target_2": entry["target_2"],
        "risk_reward": entry["risk_reward"],
        "updated_at": entry["as_of"],
    }


async def _quote_or_none(quote_fn: _QuoteFn, user_id: str, contract: str) -> dict | None:
    try:
        return await quote_fn(user_id, contract)
    except Exception:
        return None


async def get_strategy_dashboard(
    user_id: str, capital: float = 100_000.0, account_risk_pct: float = 0.5
) -> dict:
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository

    repo = McxSignalRepository()
    instruments = _instruments()
    rows = await asyncio.gather(
        *[_row_for(user_id, inst, capital, account_risk_pct, repo) for inst in instruments]
    )
    # Highest-scoring first; unscored (not enough candle history yet) sink
    # to the bottom rather than sorting arbitrarily.
    ranked = sorted(rows, key=lambda r: (not r["available"], -(r["score_pct"] or 0)))
    return {
        "generated_at": ist_now().isoformat(),
        "ranked": ranked,
        "total_contracts": len(instruments),
    }


# ── Combined signals across all 3 strategies ────────────────────────────────

async def get_strategy_dashboard_signals(user_id: str, limit: int = 200) -> dict:
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_gold_strategy_service import list_gold_signals_with_accuracy
    from app.services.mcx_ng_strategy_service import list_ng_signals_with_accuracy
    from app.services.mcx_silver_strategy_service import list_silver_signals_with_accuracy

    repo = McxSignalRepository()
    gold, silver, ng = await asyncio.gather(
        list_gold_signals_with_accuracy(user_id, "GOLDGUINEA", limit, repo),
        list_silver_signals_with_accuracy(user_id, "SILVER100", limit, repo),
        list_ng_signals_with_accuracy(user_id, "NGMINI", limit, repo),
    )

    tagged: list[dict[str, Any]] = []
    for src, name, icon in (
        (gold, "Gold Guinea", "🥇"),
        (silver, "Silver100", "🥈"),
        (ng, "NG Mini", "⛽"),
    ):
        for s in src["signals"]:
            tagged.append({**s, "contract": src["contract"], "name": name, "icon": icon})
    tagged.sort(key=lambda s: s["generated_at"], reverse=True)

    return {
        "generated_at": ist_now().isoformat(),
        "signals": tagged[:limit],
        "accuracy": {
            "GOLDGUINEA": gold["accuracy"],
            "SILVER100": silver["accuracy"],
            "NGMINI": ng["accuracy"],
        },
    }


# ── Performance table across all 3 strategies ───────────────────────────────
# Real backtest metrics (BacktestMetrics via compute_metrics) over each
# contract's own actually-logged, actually-closed signals -- same "backtest
# the user's own real recorded outcomes" principle run_gold_strategy_backtest
# itself documents, just surfaced as one combined table instead of three
# separate per-panel backtest cards.

async def get_strategy_dashboard_performance(user_id: str, capital: float = 100_000.0) -> dict:
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_gold_strategy_service import run_gold_strategy_backtest
    from app.services.mcx_ng_strategy_service import run_ng_strategy_backtest
    from app.services.mcx_silver_strategy_service import run_silver_strategy_backtest

    repo = McxSignalRepository()
    gold, silver, ng = await asyncio.gather(
        run_gold_strategy_backtest(user_id, "GOLDGUINEA", repo, capital),
        run_silver_strategy_backtest(user_id, "SILVER100", repo, capital),
        run_ng_strategy_backtest(user_id, "NGMINI", repo, capital),
    )

    rows = []
    for src, name, icon in (
        (gold, "Gold Guinea", "🥇"),
        (silver, "Silver100", "🥈"),
        (ng, "NG Mini", "⛽"),
    ):
        m = src["full_metrics"]
        rows.append(
            {
                "contract": src["contract"],
                "name": name,
                "icon": icon,
                "total_trades": m["total_trades"],
                "win_rate_pct": m["win_rate_pct"],
                "net_pnl": m["net_pnl"],
                "profit_factor": m["profit_factor"],
                "expectancy": m["expectancy"],
                "max_drawdown_pct": m["max_drawdown_pct"],
                "sharpe_ratio": m["sharpe_ratio"],
                "recovery_factor": m["recovery_factor"],
                "avg_holding_hours": m["avg_holding_hours"],
                "long_trades": m["long_trades"],
                "short_trades": m["short_trades"],
                "long_win_rate_pct": m["long_win_rate_pct"],
                "short_win_rate_pct": m["short_win_rate_pct"],
            }
        )

    return {"generated_at": ist_now().isoformat(), "capital": capital, "rows": rows}

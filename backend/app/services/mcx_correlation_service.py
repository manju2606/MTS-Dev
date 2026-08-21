"""Cross-instrument correlation for MCX contracts -- Pearson correlation of
period returns between GoldGuinea, Silver100, and NG Mini (or any tracked
MCX contracts), computed from the 5-minute candles the scheduler already
accumulates in mcx_candles (see core/scheduler.py's mcx_candle_collect job
and infra/db/repositories/mcx_candle_repo.py).

Distinct from portfolio.py's /assistant/correlation (that one correlates a
user's actual stock holdings via yfinance daily closes) and from the
per-instrument correlation category inside mcx_ai_score_service.py /
mcx_metals_ai_score_service.py (those correlate one MCX contract against an
external commodity index, not MCX contracts against each other).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.infra.db.repositories.mcx_candle_repo import McxCandleRepository

DEFAULT_CONTRACTS: list[str] = ["GOLDGUINEA", "SILVER100", "NGMINI"]


async def compute_mcx_correlation(
    contracts: list[str] | None = None,
    interval: str = "5minute",
    days: int = 30,
    repo: McxCandleRepository | None = None,
) -> dict:
    """Pearson correlation matrix of period returns between `contracts`,
    using the 5-minute candles already accumulated in mcx_candles. Returns
    {"symbols": [...], "matrix": [[...]], "sample_size": int, "interval":
    interval, "window_days": days} -- symbols/matrix are empty if fewer than
    two contracts have enough overlapping candle history yet (a fresh
    deployment hasn't accumulated any, or an unrecognized contract was
    passed)."""
    import pandas as pd

    contracts = contracts or DEFAULT_CONTRACTS
    repo = repo or McxCandleRepository()

    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    start_ts, end_ts = int(start.timestamp()), int(end.timestamp())

    series: dict[str, pd.Series] = {}
    for contract in contracts:
        candles = await repo.get_range(contract.upper(), interval, start_ts, end_ts)
        if len(candles) < 10:
            continue
        series[contract.upper()] = pd.Series(
            {c["time"]: c["close"] for c in candles}
        ).sort_index()

    empty = {
        "symbols": [], "matrix": [], "sample_size": 0, "interval": interval, "window_days": days,
    }
    if len(series) < 2:
        return empty

    df = pd.DataFrame(series)
    # Inner-join on shared candle timestamps only -- NG and Metals sessions
    # don't align minute-for-minute, so an outer join would leave most rows
    # full of NaN returns for one leg or the other.
    df = df.dropna(how="any")
    returns = df.pct_change().dropna()
    if len(returns) < 5:
        return {**empty, "sample_size": len(returns)}

    corr = returns.corr().round(3)
    return {
        "symbols": list(corr.columns),
        "matrix": corr.values.tolist(),
        "sample_size": len(returns),
        "interval": interval,
        "window_days": days,
    }

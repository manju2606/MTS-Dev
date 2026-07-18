"""Monte Carlo simulation over a completed backtest's trade sequence --
answers "how much of this result depends on the specific order the trades
happened in" by bootstrap-resampling the trade returns thousands of times
and building a distribution of possible outcomes, rather than trusting the
one historical path as the only thing that could have happened.

Resamples each trade's `pnl_pct` (percentage return) and compounds them
multiplicatively, not raw currency `pnl` -- percentage returns scale
correctly with whatever equity a trade happens to land on in a resampled
order, matching how the backtest engine's own risk-based position sizing
(a % of current equity) already works; resampling raw currency P&L would
implicitly assume the same position size regardless of order, which isn't
what the strategy would actually do.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from app.domain.models.strategy_lab import TradeRecord

MIN_TRADES_FOR_MONTE_CARLO = 10
DEFAULT_SIMULATIONS = 2000
DEFAULT_RUIN_THRESHOLD_PCT = 50.0  # "ruin" = equity ever falls to half of starting capital


@dataclass
class MonteCarloResult:
    num_simulations: int
    trades_per_simulation: int
    starting_capital: float

    # Percentile bands of final equity across all simulations -- the actual
    # backtest result is just one draw from this distribution, not "the"
    # expected outcome.
    final_equity_p5: float
    final_equity_p25: float
    final_equity_p50: float
    final_equity_p75: float
    final_equity_p95: float

    max_drawdown_pct_p50: float
    max_drawdown_pct_p95: float  # a reasonable "bad case" drawdown to plan risk around

    net_pnl_pct_p5: float
    net_pnl_pct_p50: float
    net_pnl_pct_p95: float

    probability_of_loss_pct: float  # simulations ending below starting capital
    probability_of_ruin_pct: float  # simulations where equity ever fell to ruin_threshold_pct of capital


def run_monte_carlo(
    trades: list[TradeRecord],
    capital: float,
    num_simulations: int = DEFAULT_SIMULATIONS,
    ruin_threshold_pct: float = DEFAULT_RUIN_THRESHOLD_PCT,
    seed: int | None = None,
) -> MonteCarloResult | None:
    """None if there are too few trades for resampling to mean anything
    (MIN_TRADES_FOR_MONTE_CARLO) -- with e.g. 3 trades, every "simulation"
    is just a reordering of the same 3 outcomes, not a real distribution."""
    n = len(trades)
    if n < MIN_TRADES_FOR_MONTE_CARLO or capital <= 0:
        return None

    rng = random.Random(seed)
    pct_returns = [t.pnl_pct for t in trades]
    ruin_floor = capital * (1 - ruin_threshold_pct / 100)

    final_equities: list[float] = []
    max_drawdowns: list[float] = []
    net_pnl_pcts: list[float] = []
    loss_count = 0
    ruin_count = 0

    for _ in range(num_simulations):
        equity = capital
        peak = capital
        max_dd = 0.0
        ruined = False
        for _ in range(n):
            r = rng.choice(pct_returns)
            equity *= 1 + r / 100
            peak = max(peak, equity)
            if peak > 0:
                dd = (peak - equity) / peak * 100
                max_dd = max(max_dd, dd)
            if equity <= ruin_floor:
                ruined = True

        final_equities.append(equity)
        max_drawdowns.append(max_dd)
        net_pnl_pcts.append((equity - capital) / capital * 100)
        if equity < capital:
            loss_count += 1
        if ruined:
            ruin_count += 1

    final_equities.sort()
    max_drawdowns.sort()
    net_pnl_pcts.sort()

    def pct(arr: list[float], p: int) -> float:
        idx = min(len(arr) - 1, max(0, round(len(arr) * p / 100)))
        return round(arr[idx], 2)

    return MonteCarloResult(
        num_simulations=num_simulations,
        trades_per_simulation=n,
        starting_capital=capital,
        final_equity_p5=pct(final_equities, 5),
        final_equity_p25=pct(final_equities, 25),
        final_equity_p50=pct(final_equities, 50),
        final_equity_p75=pct(final_equities, 75),
        final_equity_p95=pct(final_equities, 95),
        max_drawdown_pct_p50=pct(max_drawdowns, 50),
        max_drawdown_pct_p95=pct(max_drawdowns, 95),
        net_pnl_pct_p5=pct(net_pnl_pcts, 5),
        net_pnl_pct_p50=pct(net_pnl_pcts, 50),
        net_pnl_pct_p95=pct(net_pnl_pcts, 95),
        probability_of_loss_pct=round(loss_count / num_simulations * 100, 1),
        probability_of_ruin_pct=round(ruin_count / num_simulations * 100, 1),
    )

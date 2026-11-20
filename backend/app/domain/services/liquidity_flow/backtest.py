"""Causal backtester for the Liquidity Flow recommendation. Pure Python.

Rules that prevent look-ahead:
- A signal uses only candles up to and including its bar's close.
- Entry is the NEXT bar's open, plus slippage.
- Stop and target are the levels the engine produced at signal time.
- If one bar touches both stop and target, the stop is assumed to fill first
  (the conservative choice, because intrabar order is unknown).
- One position at a time. A new signal is only taken after the previous trade exits.

Walk-forward here is a segmented out-of-sample stability check. No parameters are
optimised, so it does not measure fitting. It measures whether the same rules
behaved similarly across consecutive, unseen segments of history.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field
from typing import Any

from app.domain.services.liquidity_flow.engine import Candle, EngineConfig, analyze


@dataclass(frozen=True)
class BacktestConfig:
    warmup: int = 60
    max_hold_bars: int = 10
    slippage_pct: float = 0.05  # applied on entry and on exit, adverse to the trader
    engine: EngineConfig = field(default_factory=EngineConfig)


@dataclass
class Trade:
    side: str  # BUY | SELL
    signal_index: int
    entry_index: int
    entry_time: int
    entry: float
    stop: float
    target: float
    exit_index: int
    exit_time: int
    exit_price: float
    reason: str  # stop | target | time
    r_multiple: float
    confidence: float


def _apply_slippage(price: float, side: str, is_entry: bool, pct: float) -> float:
    adverse = (side == "BUY") == is_entry  # buying entry or selling exit pays up
    return price * (1 + pct / 100) if adverse else price * (1 - pct / 100)


def run_backtest(candles: list[Candle], cfg: BacktestConfig | None = None) -> list[Trade]:
    cfg = cfg or BacktestConfig()
    trades: list[Trade] = []
    n = len(candles)
    i = cfg.warmup
    while i < n - 1:
        window = candles[: i + 1]
        try:
            rec = analyze(window, cfg=cfg.engine).recommendation
        except ValueError:
            i += 1
            continue
        side = rec["signal"]
        if side == "HOLD":
            i += 1
            continue

        entry_idx = i + 1
        entry = _apply_slippage(candles[entry_idx].open, side, True, cfg.slippage_pct)
        stop = float(rec["stop_loss"])
        target = float(rec["target"])
        risk = abs(entry - stop)
        if risk <= 0:
            i += 1
            continue

        exit_idx = min(n - 1, entry_idx + cfg.max_hold_bars - 1)
        exit_price = candles[exit_idx].close
        reason = "time"
        for j in range(entry_idx, min(n, entry_idx + cfg.max_hold_bars)):
            bar = candles[j]
            if side == "BUY":
                hit_stop = bar.low <= stop
                hit_target = bar.high >= target
            else:
                hit_stop = bar.high >= stop
                hit_target = bar.low <= target
            if hit_stop:  # stop checked first on ambiguous bars
                exit_idx, exit_price, reason = j, stop, "stop"
                break
            if hit_target:
                exit_idx, exit_price, reason = j, target, "target"
                break
        exit_price = _apply_slippage(exit_price, side, False, cfg.slippage_pct)

        signed = (exit_price - entry) if side == "BUY" else (entry - exit_price)
        trades.append(
            Trade(
                side=side,
                signal_index=i,
                entry_index=entry_idx,
                entry_time=candles[entry_idx].time,
                entry=round(entry, 2),
                stop=round(stop, 2),
                target=round(target, 2),
                exit_index=exit_idx,
                exit_time=candles[exit_idx].time,
                exit_price=round(exit_price, 2),
                reason=reason,
                r_multiple=round(signed / risk, 3),
                confidence=float(rec["confidence"]),
            )
        )
        i = exit_idx + 1
    return trades


def compute_metrics(trades: list[Trade]) -> dict[str, float | int | None]:
    if not trades:
        return {
            "trades": 0,
            "wins": 0,
            "losses": 0,
            "win_rate": None,
            "avg_r": None,
            "expectancy_r": None,
            "profit_factor": None,
            "total_r": 0.0,
            "max_drawdown_r": 0.0,
            "avg_bars_held": None,
            "long": 0,
            "short": 0,
        }
    rs = [t.r_multiple for t in trades]
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    gross_loss = abs(sum(losses))
    equity = peak = dd = 0.0
    for r in rs:
        equity += r
        peak = max(peak, equity)
        dd = max(dd, peak - equity)
    held = [t.exit_index - t.entry_index + 1 for t in trades]
    return {
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades), 3),
        "avg_r": round(sum(rs) / len(rs), 3),
        "expectancy_r": round(sum(rs) / len(rs), 3),
        "profit_factor": round(sum(wins) / gross_loss, 3) if gross_loss > 0 else None,
        "total_r": round(sum(rs), 3),
        "max_drawdown_r": round(dd, 3),
        "avg_bars_held": round(sum(held) / len(held), 2),
        "long": sum(1 for t in trades if t.side == "BUY"),
        "short": sum(1 for t in trades if t.side == "SELL"),
    }


def walk_forward(
    candles: list[Candle], folds: int = 3, cfg: BacktestConfig | None = None
) -> dict[str, Any]:
    """Split history into consecutive segments and backtest each one independently."""
    cfg = cfg or BacktestConfig()
    if folds < 2:
        raise ValueError("folds must be at least 2")
    size = len(candles) // folds
    if size < cfg.warmup + cfg.max_hold_bars + 5:
        raise ValueError("not enough history for the requested number of folds")
    segments: list[dict[str, Any]] = []
    for k in range(folds):
        seg = candles[k * size : (k + 1) * size if k < folds - 1 else len(candles)]
        trades = run_backtest(seg, cfg)
        m = compute_metrics(trades)
        segments.append(
            {
                "fold": k + 1,
                "from": seg[0].time,
                "to": seg[-1].time,
                "bars": len(seg),
                "metrics": m,
            }
        )
    positive = sum(1 for s in segments if (s["metrics"]["expectancy_r"] or 0) > 0)
    return {
        "folds": folds,
        "segments": segments,
        "positive_expectancy_folds": positive,
        "stability": round(positive / folds, 3),
    }


def monte_carlo(r_multiples: list[float], sims: int = 1000, seed: int = 42) -> dict[str, Any]:
    """Bootstrap the trade results: draw len(trades) trades WITH replacement, `sims` times.
    This shows how much the outcome could vary given the sample size. Plain shuffling
    would not work here, because reordering never changes the total R.
    Seeded so identical inputs always give identical output."""
    if not r_multiples:
        return {"sims": 0}
    rng = random.Random(seed)
    n = len(r_multiples)
    finals: list[float] = []
    drawdowns: list[float] = []
    for _ in range(sims):
        sample = [r_multiples[rng.randrange(n)] for _ in range(n)]
        eq = peak = dd = 0.0
        for r in sample:
            eq += r
            peak = max(peak, eq)
            dd = max(dd, peak - eq)
        finals.append(eq)
        drawdowns.append(dd)
    finals.sort()
    drawdowns.sort()

    def pct(xs: list[float], p: float) -> float:
        return round(xs[min(len(xs) - 1, int(p * len(xs)))], 3)

    return {
        "sims": sims,
        "method": "bootstrap_with_replacement",
        "final_r_p5": pct(finals, 0.05),
        "final_r_p50": pct(finals, 0.50),
        "final_r_p95": pct(finals, 0.95),
        "max_dd_r_p50": pct(drawdowns, 0.50),
        "max_dd_r_p95": pct(drawdowns, 0.95),
        "prob_profit": round(sum(1 for f in finals if f > 0) / sims, 3),
    }


def trade_to_dict(t: Trade) -> dict[str, Any]:
    return asdict(t)

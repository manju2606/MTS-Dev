"""Kotegawa Historical Backtest — walk-forward, multi-symbol re-simulation
of the Kotegawa capitulation/kairi/volume/reversal rule set against real
past daily OHLCV, producing an actual trade sample right now instead of
waiting for the live strategies' real picks to accumulate (see
strategy_lab_live_backtest_service.py's own docstring for why this kind of
day-by-day scanner re-simulation was deliberately NOT built for Golden
Stock/BTST/etc. -- it needs "a whole separate point-in-time scanning
engine... replicating each one's live universe-scan logic against
historical OHLCV day by day". Built here, scoped specifically to Kotegawa,
because its rule set is simple/self-contained enough to make that
tractable).

All three Kotegawa variants (Reversal/Early/Intraday) share the exact same
scoring math (kotegawa_scanner._compute_features/_score_candidate) -- they
only differ in universe, min_score, and how long a signal gets to resolve
(see VARIANT_CONFIG). One engine handles all three so a rule-set tweak
can't drift out of sync between them.

Honesty caveat on Early/Intraday's "same-day" resolution: this only has
daily OHLCV, not the 5-min intraday bars the live same-day LTP-polling
resolver uses, so it can't truly replicate that mechanism. The best-faith
historical proxy (same_day_check=True) is: check whether the signal day's
OWN high/low range already touched target/stop before falling through to
subsequent days, capped at a short window -- an approximation, not
presented as equivalent to the live mechanism.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta
from typing import Literal, TypedDict

import pandas as pd
import structlog
import yfinance as yf

from app.domain.models.strategy_lab import TradeRecord
from app.domain.services.strategy_lab.engine import BacktestOutcome
from app.domain.services.strategy_lab.metrics import compute_metrics, drawdown_curve
from app.infra.scanner.kotegawa_scanner import _compute_features, _score_candidate
from app.infra.scanner.universe import NIFTY_100, NIFTY_500

log = structlog.get_logger()

KotegawaVariant = Literal["reversal", "early", "intraday"]


class _VariantConfig(TypedDict):
    symbols: list[str]
    min_score: int
    resolution_window_days: int
    same_day_check: bool
    label: str


VARIANT_CONFIG: dict[KotegawaVariant, _VariantConfig] = {
    "reversal": {
        "symbols": NIFTY_500, "min_score": 55, "resolution_window_days": 5,
        "same_day_check": False, "label": "Kotegawa Reversal (BNF Style)",
    },
    "early": {
        "symbols": NIFTY_500, "min_score": 55, "resolution_window_days": 2,
        "same_day_check": True, "label": "Kotegawa Early Reversal (Intraday Entry)",
    },
    "intraday": {
        "symbols": NIFTY_100, "min_score": 65, "resolution_window_days": 2,
        "same_day_check": True, "label": "Kotegawa Intraday (NIFTY 100)",
    },
}

# Extra history before from_date so SMA25/RSI/3-day-decline have real warmup
# data on the FIRST simulated day, not NaN-derived zeros.
WARMUP_DAYS = 45


def _resolve_trade(
    high_s: pd.Series,
    low_s: pd.Series,
    close_s: pd.Series,
    signal_pos: int,
    entry_price: float,
    stop_loss: float,
    target_1: float,
    window_days: int,
    same_day_check: bool,
) -> tuple[int, float, str]:
    """Walks forward from signal_pos (same-day check first if requested,
    then subsequent days) up to window_days, checking stop before target
    (same tie-break convention as btst_service.backfill_btst_outcomes /
    golden_stock_service's own backfill). Returns (exit_pos, exit_price,
    exit_reason). Falls back to the window's last available day's close as
    an "eod" (expiry) exit if neither level is touched."""
    start = signal_pos if same_day_check else signal_pos + 1
    last_pos = min(signal_pos + window_days, len(close_s) - 1)
    for pos in range(start, last_pos + 1):
        if pos >= len(close_s):
            break
        day_low = float(low_s.iloc[pos])
        day_high = float(high_s.iloc[pos])
        if day_low <= stop_loss:
            return pos, stop_loss, "stop_loss"
        if day_high >= target_1:
            return pos, target_1, "target"
    return last_pos, float(close_s.iloc[last_pos]), "eod"


async def run_kotegawa_historical_backtest(
    variant: KotegawaVariant, from_date: str, to_date: str, capital: float
) -> dict:
    cfg = VARIANT_CONFIG[variant]
    symbols = list(cfg["symbols"])
    min_score = cfg["min_score"]
    window_days = cfg["resolution_window_days"]
    same_day_check = cfg["same_day_check"]

    from_dt = datetime.strptime(from_date, "%Y-%m-%d")
    to_dt = datetime.strptime(to_date, "%Y-%m-%d")
    dl_start = (from_dt - timedelta(days=WARMUP_DAYS)).strftime("%Y-%m-%d")
    dl_end = (to_dt + timedelta(days=window_days + 5)).strftime("%Y-%m-%d")

    log.info(
        "kotegawa_hist.start", variant=variant, symbols=len(symbols),
        from_date=from_date, to_date=to_date,
    )

    try:
        nifty_raw = yf.download(
            "^NSEI", start=dl_start, end=dl_end, auto_adjust=True, progress=False
        )
        nifty_close = nifty_raw["Close"].dropna()
        if hasattr(nifty_close, "iloc") and nifty_close.ndim > 1:
            nifty_close = nifty_close.iloc[:, 0]
        nifty_chg = nifty_close.pct_change().fillna(0.0) * 100
        # date string -> nifty change_pct that day, for _score_candidate's
        # "stock-specific weakness vs Nifty" reasoning input.
        nifty_chg_by_date = {d.strftime("%Y-%m-%d"): float(v) for d, v in nifty_chg.items()}
        trading_days = [d.strftime("%Y-%m-%d") for d in nifty_close.index]
    except Exception as exc:
        log.error("kotegawa_hist.nifty_error", error=str(exc))
        nifty_chg_by_date = {}
        trading_days = []

    window_days_in_range = [d for d in trading_days if from_date <= d <= to_date]

    try:
        raw = yf.download(
            symbols, start=dl_start, end=dl_end, group_by="ticker",
            threads=True, progress=False, auto_adjust=True,
        )
    except Exception as exc:
        log.error("kotegawa_hist.download_error", variant=variant, error=str(exc))
        raw = None

    all_trades: list[TradeRecord] = []
    signals_generated = 0
    single_sym = len(symbols) == 1

    for sym in symbols:
        try:
            df = raw if single_sym else (
                raw[sym] if raw is not None and sym in raw.columns.get_level_values(0) else None
            )
            if df is None or df.empty:
                continue
            close_s = df["Close"].dropna()
            high_s = df["High"].dropna()
            low_s = df["Low"].dropna()
            volume_s = df["Volume"].dropna()
            if len(close_s) < 30:
                continue

            date_strs = [d.strftime("%Y-%m-%d") for d in close_s.index]
            date_to_pos = {d: i for i, d in enumerate(date_strs)}

            occupied_until = -1
            for day in window_days_in_range:
                pos = date_to_pos.get(day)
                if pos is None or pos < 30 or pos <= occupied_until:
                    continue

                features = _compute_features(
                    sym, close_s.iloc[: pos + 1], high_s.iloc[: pos + 1],
                    low_s.iloc[: pos + 1], volume_s.iloc[: pos + 1],
                )
                if features is None:
                    continue

                nifty_chg_today = nifty_chg_by_date.get(day, 0.0)
                candidate = _score_candidate(features, sym, nifty_chg_today, min_score)
                if candidate is None:
                    continue

                signals_generated += 1
                exit_pos, exit_price, exit_reason = _resolve_trade(
                    high_s, low_s, close_s, pos,
                    candidate.entry_price, candidate.stop_loss, candidate.target_1,
                    window_days, same_day_check,
                )
                occupied_until = exit_pos

                entry_time = close_s.index[pos].to_pydatetime().replace(tzinfo=None)
                exit_time = close_s.index[exit_pos].to_pydatetime().replace(tzinfo=None)
                if exit_time == entry_time:
                    exit_time = entry_time.replace(hour=15, minute=30)

                qty = max(1, int(capital // candidate.entry_price))
                pnl = round((exit_price - candidate.entry_price) * qty, 2)
                pnl_pct = round(
                    (exit_price - candidate.entry_price) / candidate.entry_price * 100, 2
                )

                all_trades.append(
                    TradeRecord(
                        entry_time=entry_time, exit_time=exit_time, signal="BUY",
                        entry_price=candidate.entry_price, exit_price=exit_price,
                        quantity=qty, pnl=pnl, pnl_pct=pnl_pct, exit_reason=exit_reason,
                    )
                )
        except Exception as exc:
            log.debug("kotegawa_hist.symbol_error", symbol=sym, error=str(exc))
            continue

    all_trades.sort(key=lambda t: t.exit_time)

    log.info(
        "kotegawa_hist.done", variant=variant, signals=signals_generated,
        trades=len(all_trades),
    )

    if not all_trades:
        outcome = BacktestOutcome(trades=[], equity_curve=[], final_equity=capital)
        metrics = compute_metrics(outcome, capital)
        return {
            "source": variant,
            "label": cfg["label"],
            "full_metrics": dataclasses.asdict(metrics),
            "equity_curve": [],
            "drawdown_curve": [],
            "trades": [],
            "total_trades": 0,
            "total_picks_before_gates": signals_generated,
        }

    equity_curve = [{"time": all_trades[0].entry_time.isoformat(), "equity": capital}]
    running = capital
    for t in all_trades:
        running += t.pnl
        equity_curve.append({"time": t.exit_time.isoformat(), "equity": round(running, 2)})

    outcome = BacktestOutcome(trades=all_trades, equity_curve=equity_curve, final_equity=running)
    metrics = compute_metrics(outcome, capital)

    return {
        "source": variant,
        "label": cfg["label"],
        "full_metrics": dataclasses.asdict(metrics),
        "equity_curve": equity_curve,
        "drawdown_curve": drawdown_curve(equity_curve),
        "trades": [dataclasses.asdict(t) for t in all_trades[-200:]],
        "total_trades": len(all_trades),
        "total_picks_before_gates": signals_generated,
    }

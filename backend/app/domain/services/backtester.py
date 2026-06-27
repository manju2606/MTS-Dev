"""Phase 2 Backtester — SMA-20/50 crossover strategy on yfinance history."""

import asyncio
from dataclasses import dataclass

import yfinance as yf


@dataclass
class BacktestTrade:
    date_in: str
    date_out: str
    signal: str
    entry: float
    exit: float
    pnl: float
    pnl_pct: float


@dataclass
class BacktestResult:
    symbol: str
    strategy: str
    period: str
    start_date: str
    end_date: str
    total_return_pct: float
    max_drawdown_pct: float
    win_rate_pct: float
    total_trades: int
    sharpe_ratio: float
    trades: list[BacktestTrade]
    equity_curve: list[dict]  # [{date, value}]


def _sma(values: list[float], n: int, i: int) -> float | None:
    if i < n - 1:
        return None
    return sum(values[i - n + 1 : i + 1]) / n


def _run_sma_crossover(symbol: str, period: str) -> BacktestResult:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period)
    if hist.empty or len(hist) < 55:
        raise ValueError(f"Not enough history for '{symbol}' ({period})")

    closes = [float(v) for v in hist["Close"].tolist()]
    dates = [str(d.date()) for d in hist.index.tolist()]
    n = len(closes)

    capital = 100_000.0
    equity = capital
    in_trade = False
    entry_price = 0.0
    entry_date = ""
    qty = 0
    trades: list[BacktestTrade] = []
    equity_curve: list[dict] = [{"date": dates[49], "value": round(capital, 2)}]

    for i in range(50, n):
        s20_now = _sma(closes, 20, i)
        s50_now = _sma(closes, 50, i)
        s20_prev = _sma(closes, 20, i - 1)
        s50_prev = _sma(closes, 50, i - 1)
        if None in (s20_now, s50_now, s20_prev, s50_prev):
            continue

        # Golden cross → BUY
        if s20_prev <= s50_prev and s20_now > s50_now and not in_trade:  # type: ignore[operator]
            entry_price = closes[i]
            entry_date = dates[i]
            qty = max(1, int(equity * 0.95 / entry_price))
            in_trade = True

        # Death cross → EXIT
        elif s20_prev >= s50_prev and s20_now < s50_now and in_trade:  # type: ignore[operator]
            exit_p = closes[i]
            pnl = (exit_p - entry_price) * qty
            pnl_pct = (exit_p - entry_price) / entry_price * 100
            equity += pnl
            trades.append(
                BacktestTrade(
                    date_in=entry_date,
                    date_out=dates[i],
                    signal="BUY",
                    entry=round(entry_price, 2),
                    exit=round(exit_p, 2),
                    pnl=round(pnl, 2),
                    pnl_pct=round(pnl_pct, 2),
                )
            )
            in_trade = False
            equity_curve.append({"date": dates[i], "value": round(equity, 2)})

        elif i % 10 == 0:
            cur = equity + (closes[i] - entry_price) * qty if in_trade else equity
            equity_curve.append({"date": dates[i], "value": round(cur, 2)})

    # Close any open trade at end of period
    if in_trade:
        exit_p = closes[-1]
        pnl = (exit_p - entry_price) * qty
        pnl_pct = (exit_p - entry_price) / entry_price * 100
        equity += pnl
        trades.append(
            BacktestTrade(
                date_in=entry_date,
                date_out=dates[-1],
                signal="BUY",
                entry=round(entry_price, 2),
                exit=round(exit_p, 2),
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
            )
        )
        equity_curve.append({"date": dates[-1], "value": round(equity, 2)})

    total_return = (equity - capital) / capital * 100

    # Max drawdown
    peak = capital
    max_dd = 0.0
    running = capital
    for t in trades:
        running += t.pnl
        peak = max(peak, running)
        dd = (peak - running) / peak * 100
        max_dd = max(max_dd, dd)

    wins = sum(1 for t in trades if t.pnl > 0)
    win_rate = wins / len(trades) * 100 if trades else 0.0

    if len(trades) > 1:
        rets = [t.pnl_pct for t in trades]
        avg_r = sum(rets) / len(rets)
        std_r = (sum((r - avg_r) ** 2 for r in rets) / len(rets)) ** 0.5
        sharpe = round(avg_r / std_r * (252**0.5) / 100, 2) if std_r > 0 else 0.0
    else:
        sharpe = 0.0

    return BacktestResult(
        symbol=symbol,
        strategy="SMA 20/50 Crossover",
        period=period,
        start_date=dates[49],
        end_date=dates[-1],
        total_return_pct=round(total_return, 2),
        max_drawdown_pct=round(max_dd, 2),
        win_rate_pct=round(win_rate, 2),
        total_trades=len(trades),
        sharpe_ratio=sharpe,
        trades=trades,
        equity_curve=equity_curve,
    )


class Backtester:
    async def run_sma_crossover(self, symbol: str, period: str = "6mo") -> BacktestResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _run_sma_crossover, symbol, period)

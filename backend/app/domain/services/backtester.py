"""Phase 2 Backtester — SMA/RSI/MACD strategies on yfinance history."""

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


def _load_ohlcv(symbol: str, period: str, min_bars: int = 55) -> tuple[list[float], list[str]]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period)
    if hist.empty or len(hist) < min_bars:
        raise ValueError(f"Not enough history for '{symbol}' ({period})")
    closes = [float(v) for v in hist["Close"].tolist()]
    dates = [str(d.date()) for d in hist.index.tolist()]
    return closes, dates


def _compute_stats(
    trades: list["BacktestTrade"], capital: float
) -> tuple[float, float, float, float]:
    """Returns (total_return_pct, max_drawdown_pct, win_rate_pct, sharpe_ratio)."""
    equity = capital + sum(t.pnl for t in trades)
    total_return = (equity - capital) / capital * 100

    peak, running, max_dd = capital, capital, 0.0
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

    return round(total_return, 2), round(max_dd, 2), round(win_rate, 2), sharpe


def _ema_series(values: list[float], span: int) -> list[float]:
    """Exponential moving average using pandas-style EWM with adjust=False."""
    k = 2.0 / (span + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def _rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    """RSI using Wilder smoothing; returns None for warmup bars."""
    result: list[float | None] = [None] * len(closes)
    if len(closes) < period + 1:
        return result
    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, period + 1)]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, period + 1)]
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    result[period] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    for i in range(period + 1, len(closes)):
        g = max(closes[i] - closes[i - 1], 0.0)
        loss = max(closes[i - 1] - closes[i], 0.0)
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + loss) / period
        result[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return result


def _sma(values: list[float], n: int, i: int) -> float | None:
    if i < n - 1:
        return None
    return sum(values[i - n + 1 : i + 1]) / n


def _run_sma_crossover(symbol: str, period: str) -> BacktestResult:
    closes, dates = _load_ohlcv(symbol, period, min_bars=55)
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

    total_return, max_dd, win_rate, sharpe = _compute_stats(trades, capital)
    return BacktestResult(
        symbol=symbol,
        strategy="SMA 20/50 Crossover",
        period=period,
        start_date=dates[49],
        end_date=dates[-1],
        total_return_pct=total_return,
        max_drawdown_pct=max_dd,
        win_rate_pct=win_rate,
        total_trades=len(trades),
        sharpe_ratio=sharpe,
        trades=trades,
        equity_curve=equity_curve,
    )


def _run_rsi_mean_reversion(symbol: str, period: str) -> BacktestResult:
    """RSI-14 mean-reversion: buy when RSI < 30, exit when RSI > 65."""
    closes, dates = _load_ohlcv(symbol, period, min_bars=30)
    rsi = _rsi_series(closes)
    n = len(closes)

    capital = 100_000.0
    in_trade = False
    entry_price = entry_date = ""
    qty = 0
    trades: list[BacktestTrade] = []
    equity = capital
    equity_curve: list[dict] = [{"date": dates[14], "value": round(capital, 2)}]

    for i in range(15, n):
        if rsi[i] is None:
            continue
        r = rsi[i]
        assert r is not None  # mypy

        if not in_trade and r < 30:
            entry_price = closes[i]
            entry_date = dates[i]
            qty = max(1, int(equity * 0.95 / entry_price))
            in_trade = True
        elif in_trade and r > 65:
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
            equity_curve.append({"date": dates[i], "value": round(equity, 2)})
            in_trade = False
        elif i % 10 == 0:
            cur = equity + (closes[i] - entry_price) * qty if in_trade else equity
            equity_curve.append({"date": dates[i], "value": round(cur, 2)})

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

    total_return, max_dd, win_rate, sharpe = _compute_stats(trades, capital)
    return BacktestResult(
        symbol=symbol,
        strategy="RSI Mean-Reversion",
        period=period,
        start_date=dates[14],
        end_date=dates[-1],
        total_return_pct=total_return,
        max_drawdown_pct=max_dd,
        win_rate_pct=win_rate,
        total_trades=len(trades),
        sharpe_ratio=sharpe,
        trades=trades,
        equity_curve=equity_curve,
    )


def _run_macd_crossover(symbol: str, period: str) -> BacktestResult:
    """MACD crossover: buy on bullish crossover (MACD > Signal), exit on bearish."""
    closes, dates = _load_ohlcv(symbol, period, min_bars=35)
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    macd = [e12 - e26 for e12, e26 in zip(ema12, ema26, strict=True)]
    signal_line = _ema_series(macd, 9)
    n = len(closes)

    capital = 100_000.0
    in_trade = False
    entry_price = entry_date = ""
    qty = 0
    trades: list[BacktestTrade] = []
    equity = capital
    equity_curve: list[dict] = [{"date": dates[34], "value": round(capital, 2)}]

    for i in range(35, n):
        m_now, s_now = macd[i], signal_line[i]
        m_prev, s_prev = macd[i - 1], signal_line[i - 1]

        if not in_trade and m_prev <= s_prev and m_now > s_now:
            entry_price = closes[i]
            entry_date = dates[i]
            qty = max(1, int(equity * 0.95 / entry_price))
            in_trade = True
        elif in_trade and m_prev >= s_prev and m_now < s_now:
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
            equity_curve.append({"date": dates[i], "value": round(equity, 2)})
            in_trade = False
        elif i % 10 == 0:
            cur = equity + (closes[i] - entry_price) * qty if in_trade else equity
            equity_curve.append({"date": dates[i], "value": round(cur, 2)})

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

    total_return, max_dd, win_rate, sharpe = _compute_stats(trades, capital)
    return BacktestResult(
        symbol=symbol,
        strategy="MACD Crossover",
        period=period,
        start_date=dates[34],
        end_date=dates[-1],
        total_return_pct=total_return,
        max_drawdown_pct=max_dd,
        win_rate_pct=win_rate,
        total_trades=len(trades),
        sharpe_ratio=sharpe,
        trades=trades,
        equity_curve=equity_curve,
    )


class Backtester:
    async def run_sma_crossover(self, symbol: str, period: str = "6mo") -> BacktestResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _run_sma_crossover, symbol, period)

    async def run_rsi_mean_reversion(self, symbol: str, period: str = "6mo") -> BacktestResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _run_rsi_mean_reversion, symbol, period)

    async def run_macd_crossover(self, symbol: str, period: str = "6mo") -> BacktestResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _run_macd_crossover, symbol, period)

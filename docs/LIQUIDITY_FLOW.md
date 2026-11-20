# Liquidity Flow

Smart Money Concepts analytics for NSE and BSE stocks. It lives under **Markets → Liquidity Flow**.
This is a research and analytics tool. It does not place orders.

## Feature flag

| Layer | Variable | Default | Effect when `false` |
|---|---|---|---|
| Backend | `ENABLE_LIQUIDITY_AI` | `true` | `/api/v1/liquidity-flow/*` is not mounted |
| Frontend | `NEXT_PUBLIC_ENABLE_LIQUIDITY_AI` | on | Menu item hidden, page shows "turned off" |

## Layout

```
backend/app/domain/services/liquidity_flow/   pure Python, no I/O
  engine.py          swings, BOS/CHoCH, order blocks, liquidity pools, sweeps, recommendation
  order_flow.py      volume profile, estimated CVD, footprint, depth imbalance
  backtest.py        causal backtester, segmented walk-forward, bootstrap Monte Carlo
  multi_timeframe.py daily-bias / hourly-confirm verdict
backend/app/services/liquidity_scanner.py     market-wide scan (orchestration, cached 10 min)
backend/app/infra/market_data/liquidity_candles.py   yfinance OHLCV (cached 5 min)
backend/app/api/v1/liquidity_flow.py          HTTP routes
frontend/app/liquidity-flow/                  page, tabs, panels
```

## Algorithms

- **Swing points:** fractal pivots with `pivot_left` / `pivot_right` candles (default 3/3). A pivot is confirmed only at `index + right`, so the engine never uses future candles. Each pivot has a `strength` (0–1): its lead over the nearest rival swing, as a share of the window range.
- **BOS / CHoCH:** a close beyond the last unbroken swing. BOS continues the trend. CHoCH runs against it. Each swing is consumed once broken.
- **Order blocks:** for a bullish break, the last down-close candle between the impulse's origin swing low and the break. Mirror for bearish. A block is *mitigated* once a later close trades through it.
- **Liquidity pools:** clusters of equal highs (buy-side) and equal lows (sell-side) within `equal_tolerance_pct`, plus the latest unbroken swing on each side. Removed once a later close trades through.
- **Sweeps:** a wick through a known swing that closes back inside it. Buy-side sweep is bearish. Sell-side sweep is bullish.
- **Recommendation:** net score = bullish evidence − bearish evidence. Trend contributes 0.35, an active order block at price 0.25, a recent sweep 0.25. BUY at net ≥ +0.30, SELL at net ≤ −0.30, otherwise HOLD. Confidence = min(0.95, |net|). A directional call is downgraded to HOLD if reward:risk is below 1.5. Every output carries the full schema: signal, confidence, entry, stop, target, risk/reward, holding period, explanation.

## Backtest rules (no look-ahead)

- A signal uses only candles up to and including its bar's close.
- Entry at the **next bar's open**, with adverse slippage (default 0.05% per side).
- Stop and target are the levels the engine produced at signal time.
- If one bar touches both stop and target, the **stop fills first** (conservative).
- One position at a time. A new signal is taken only after the previous trade exits.
- Test `test_backtest_is_causal_*` changes future candles and checks that earlier trades are identical.

**Walk-forward here is a segmented out-of-sample stability check.** No parameters are optimised, so it does not measure curve-fitting. It shows whether the same rules behaved similarly across consecutive, unseen segments.

**Monte Carlo** resamples trades with replacement (bootstrap), 1000 runs, seeded. Plain shuffling was rejected because reordering never changes the total R.

## Data and what is real

| Item | Status |
|---|---|
| Daily candles (NSE/BSE) | Real, from yfinance (`.NS` / `.BO`) |
| Hourly candles | Real, from yfinance (last 60 days only) |
| Volume profile | **Estimate.** Bar volume spread across each bar's range |
| CVD | **Estimate.** From where each close sits in its range. Not aggressor volume |
| Footprint (bid/ask volume per price) | **Needs a tick feed.** Engine is built and tested. The API reports it unavailable |
| Bid/ask depth imbalance | **Needs an order-book feed.** Engine is built and tested. Reported unavailable |
| Open interest | **Not wired.** The existing `/options` endpoint has the chain data |
| MCX commodities | **Not covered.** yfinance does not reliably cover MCX contracts. The project's Kite historical candles could be wired in later |
| Persistence | None. Results are computed on demand and cached in memory |
| Live WebSocket updates | Not built. Analysis refreshes on request |

## API

All routes are under `/api/v1/liquidity-flow/` and require a logged-in user.

| Route | Purpose |
|---|---|
| `GET /analyze?symbol&interval=1d\|1h` | Full analysis, recommendation, chart candles |
| `GET /mtf?symbol` | Daily bias confirmed by hourly |
| `GET /backtest?symbol&interval&max_hold&folds&slippage_pct` | Trades, metrics, walk-forward segments, Monte Carlo |
| `GET /scan?universe=nifty50\|nifty100\|nifty200&side&limit` | Ranked setups across an index universe |
| `GET /order-flow?symbol&interval` | Volume profile, estimated CVD, availability of feed-based views |

Errors: `422` invalid symbol or insufficient history, `404` no price data, `502` upstream unavailable.

## Tests

```
cd backend && pytest tests/unit/test_liquidity_flow_engine.py tests/unit/test_liquidity_flow_extended.py
```

Synthetic candles with known answers cover pivots, structure, order blocks, sweeps, footprint, depth, backtest exits and slippage, causality, metrics, Monte Carlo, multi-timeframe verdicts, and scanner failure handling.

## Not financial advice

Every output carries a disclaimer. Backtests on a few dozen trades are noisy. Past results do not predict future performance.

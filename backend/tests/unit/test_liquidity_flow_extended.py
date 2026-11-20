"""Tests for order flow, backtesting, multi-timeframe confirmation and the scanner."""

import asyncio
import math

import pytest

from app.domain.services.liquidity_flow import backtest as bt
from app.domain.services.liquidity_flow.backtest import (
    BacktestConfig,
    compute_metrics,
    monte_carlo,
    walk_forward,
)
from app.domain.services.liquidity_flow.backtest import (
    Trade as BacktestTrade,
)
from app.domain.services.liquidity_flow.engine import (
    Candle,
    LiquidityAnalysis,
    find_pivots,
)
from app.domain.services.liquidity_flow.multi_timeframe import mtf_confirmation
from app.domain.services.liquidity_flow.order_flow import (
    DepthLevel,
    Trade,
    depth_imbalance,
    estimated_cvd,
    footprint,
    volume_profile,
)


def _c(i, o, h, lo, c, v=1000.0):
    return Candle(time=1_700_000_000 + i * 86400, open=o, high=h, low=lo, close=c, volume=v)


def _wave(n, seed_price=100.0):
    out = []
    p = seed_price
    for i in range(n):
        p += 1.2 * math.sin(i / 2.5) + 0.15
        out.append(_c(i, p - 0.4, p + 1.3, p - 1.2, p + 0.3))
    return out


# ── Pivot strength ───────────────────────────────────────────────────────────


def test_pivot_strength_is_bounded_and_positive_for_confirmed_swings():
    candles = [
        _c(0, 10, 11, 9, 10),
        _c(1, 10, 12, 9.5, 11),
        _c(2, 11, 20, 10, 15),
        _c(3, 15, 16, 10.5, 11),
        _c(4, 11, 13, 9.5, 10),
        _c(5, 10, 11, 9.2, 10),
    ]
    piv = [p for p in find_pivots(candles, 2, 2) if p.kind == "high"]
    assert piv and 0 < piv[0].strength <= 1


# ── Volume profile and CVD estimates ─────────────────────────────────────────


def test_volume_profile_poc_is_where_volume_concentrated():
    heavy = [_c(i, 100, 101, 99, 100.5, v=10_000) for i in range(5)]
    light = [_c(10 + i, 110, 112, 108, 110.5, v=100) for i in range(5)]
    vp = volume_profile(heavy + light, bins=12)
    assert vp.poc is not None and vp.poc < 105
    assert vp.value_area_low is not None and vp.value_area_high is not None
    assert vp.value_area_low <= vp.poc <= vp.value_area_high


def test_volume_profile_empty_is_safe():
    vp = volume_profile([])
    assert vp.poc is None and vp.buckets == []


def test_cvd_sign_follows_close_location():
    bullish = estimated_cvd([_c(0, 10, 12, 10, 12, v=500)])[0]
    bearish = estimated_cvd([_c(0, 12, 12, 10, 10, v=500)])[0]
    assert bullish["delta"] > 0
    assert bearish["delta"] < 0


def test_cvd_is_running_sum():
    rows = estimated_cvd([_c(0, 10, 12, 10, 12, v=100), _c(1, 12, 12, 10, 10, v=100)])
    assert rows[1]["cvd"] == pytest.approx(rows[0]["delta"] + rows[1]["delta"], abs=0.01)


# ── Footprint and depth (need real feeds, tested on synthetic input) ─────────


def test_footprint_splits_bid_and_ask_and_tags_imbalance():
    trades = [Trade(100.0, 50, "B"), Trade(100.0, 5, "S"), Trade(100.1, 1, "S")]
    fp = footprint(trades, tick_size=0.05)
    by_price = {round(lv.price, 2): lv for lv in fp.levels}
    assert by_price[100.0].ask_volume == 50
    assert by_price[100.0].bid_volume == 5
    assert by_price[100.0].imbalance == "buy"


def test_stacked_imbalance_needs_adjacent_levels():
    trades = []
    for k in range(3):
        trades.append(Trade(100.0 + 0.05 * k, 100, "B"))
        trades.append(Trade(100.0 + 0.05 * k, 1, "S"))
    stacked = footprint(trades, tick_size=0.05)
    assert stacked.stacked_buy == [100.0]

    gapped = [Trade(100.0, 100, "B"), Trade(100.2, 100, "B"), Trade(100.4, 100, "B")]
    assert footprint(gapped, tick_size=0.05).stacked_buy == []


def test_footprint_rejects_bad_tick():
    with pytest.raises(ValueError):
        footprint([], tick_size=0)


def test_depth_imbalance_bias():
    bids = [DepthLevel(99 - i, 500) for i in range(5)]
    asks = [DepthLevel(101 + i, 100) for i in range(5)]
    d = depth_imbalance(bids, asks)
    assert d.bias == "bid_heavy" and d.ratio == 5.0
    assert depth_imbalance(asks, bids).bias == "ask_heavy"


# ── Backtester ───────────────────────────────────────────────────────────────


def _flat_bars(n, price=100.0):
    return [_c(i, price, price + 0.2, price - 0.2, price) for i in range(n)]


def test_stop_is_assumed_first_on_ambiguous_bar(monkeypatch):
    fake = type(
        "A",
        (),
        {
            "recommendation": {
                "signal": "BUY",
                "stop_loss": 95.0,
                "target": 105.0,
                "confidence": 0.5,
            }
        },
    )()
    monkeypatch.setattr(bt, "analyze", lambda w, cfg=None: fake)
    candles = _flat_bars(10)
    # bar 4 (entry at bar 3's open via next-bar rule) spans both stop and target
    candles[4] = _c(4, 100, 110, 90, 100)
    trades = bt.run_backtest(candles, BacktestConfig(warmup=2, max_hold_bars=5, slippage_pct=0))
    assert trades[0].reason == "stop"
    assert trades[0].exit_price == 95.0


def test_target_exit_and_slippage_are_adverse(monkeypatch):
    fake = type(
        "A",
        (),
        {
            "recommendation": {
                "signal": "BUY",
                "stop_loss": 95.0,
                "target": 102.0,
                "confidence": 0.5,
            }
        },
    )()
    monkeypatch.setattr(bt, "analyze", lambda w, cfg=None: fake)
    candles = _flat_bars(10)
    candles[4] = _c(4, 100, 103, 99.5, 102)
    trades = bt.run_backtest(candles, BacktestConfig(warmup=2, max_hold_bars=5, slippage_pct=0.1))
    t = trades[0]
    assert t.reason == "target"
    assert t.entry > 100.0  # bought above the open
    assert t.exit_price < 102.0  # sold below the target
    assert t.r_multiple > 0


def test_backtest_is_causal_future_changes_do_not_alter_earlier_trades():
    candles = _wave(260)
    cfg = BacktestConfig(warmup=60, max_hold_bars=8, slippage_pct=0.05)
    base = bt.run_backtest(candles, cfg)
    cutoff = len(candles) - 30

    mutated = list(candles)
    for i in range(cutoff, len(candles)):
        c = mutated[i]
        mutated[i] = _c(i, c.open * 1.2, c.high * 1.2, c.low * 1.2, c.close * 1.2)
    after = bt.run_backtest(mutated, cfg)

    early_base = [t for t in base if t.exit_index < cutoff - 1]
    early_after = [t for t in after if t.exit_index < cutoff - 1]
    assert early_base == early_after


def test_trades_do_not_overlap():
    trades = bt.run_backtest(_wave(260), BacktestConfig(warmup=60, max_hold_bars=8))
    for a, b in zip(trades, trades[1:], strict=False):
        assert b.entry_index > a.exit_index


# ── Metrics, walk-forward, Monte Carlo ───────────────────────────────────────


def _t(r, side="BUY", entry=0, exit_=1):
    return BacktestTrade(side, 0, entry, 0, 1.0, 0.9, 1.1, exit_, 0, 1.0, "stop", r, 0.5)


def test_metrics_known_values():
    trades = [_t(2.0), _t(-1.0), _t(1.0), _t(-1.0)]
    m = compute_metrics(trades)
    assert m["trades"] == 4 and m["wins"] == 2
    assert m["win_rate"] == 0.5
    assert m["profit_factor"] == pytest.approx(1.5)
    assert m["total_r"] == 1.0
    assert m["max_drawdown_r"] == 1.0


def test_metrics_empty_is_safe():
    assert compute_metrics([])["trades"] == 0


def test_monte_carlo_is_seeded_and_bounded():
    rs = [1.0, -1.0, 2.0, -1.0, 1.5]
    a = monte_carlo(rs, sims=300, seed=7)
    b = monte_carlo(rs, sims=300, seed=7)
    assert a == b
    assert a["final_r_p5"] <= a["final_r_p50"] <= a["final_r_p95"]
    assert a["final_r_p5"] < a["final_r_p95"]  # bootstrap gives a real spread
    assert 0 <= a["prob_profit"] <= 1
    assert a["method"] == "bootstrap_with_replacement"


def test_monte_carlo_all_wins_never_loses():
    m = monte_carlo([1.0, 2.0, 0.5], sims=200, seed=1)
    assert m["final_r_p5"] > 0 and m["prob_profit"] == 1.0


def test_monte_carlo_empty():
    assert monte_carlo([]) == {"sims": 0}


def test_walk_forward_requires_enough_history():
    with pytest.raises(ValueError):
        walk_forward(_wave(80), folds=3)
    with pytest.raises(ValueError):
        walk_forward(_wave(300), folds=1)


def test_walk_forward_reports_each_segment():
    wf = walk_forward(_wave(400), folds=3, cfg=BacktestConfig(warmup=60, max_hold_bars=8))
    assert len(wf["segments"]) == 3
    assert 0 <= wf["stability"] <= 1


# ── Multi-timeframe ──────────────────────────────────────────────────────────


def _an(signal, trend="bullish"):
    return LiquidityAnalysis(
        last_close=100.0,
        atr=1.0,
        n_bars=60,
        trend=trend,
        recommendation={"signal": signal, "confidence": 0.5},
    )


@pytest.mark.parametrize(
    "hs,ls,verdict",
    [
        ("BUY", "BUY", "CONFIRMED BUY"),
        ("SELL", "SELL", "CONFIRMED SELL"),
        ("BUY", "SELL", "CONFLICT"),
        ("HOLD", "HOLD", "NO_EDGE"),
        ("BUY", "HOLD", "WAIT_LOWER_TF"),
        ("HOLD", "SELL", "WAIT_LOWER_TF"),
    ],
)
def test_mtf_verdicts(hs, ls, verdict):
    res = mtf_confirmation(_an(hs), _an(ls))
    assert res.verdict == verdict
    assert res.aligned == (verdict.startswith("CONFIRMED"))


# ── Scanner (feed patched, no network) ───────────────────────────────────────


def test_scanner_skips_failures_and_ranks(monkeypatch):
    from app.services import liquidity_scanner as sc

    sc._cache.clear()
    monkeypatch.setitem(sc.UNIVERSES, "tiny", ["AAA.NS", "BBB.NS", "CCC.NS"])
    calls = {}

    async def fake_fetch(sym, interval):
        calls[sym] = calls.get(sym, 0) + 1
        if sym == "BBB.NS":
            raise RuntimeError("upstream down")
        return _wave(120 if sym == "AAA.NS" else 90)

    def fake_analyze(candles, holding_period=""):
        rec = {
            "signal": "BUY" if len(candles) == 120 else "SELL",
            "confidence": 0.6 if len(candles) == 120 else 0.4,
            "entry_price": 1.0,
            "stop_loss": 0.9,
            "target": 1.2,
            "risk_reward_ratio": 2.0,
            "net_score": 0.5,
        }
        return type(
            "R",
            (),
            {
                "recommendation": rec,
                "trend": "bullish",
                "last_close": 1.0,
                "n_bars": len(candles),
                "structure_events": [],
                "sweeps": [],
            },
        )()

    monkeypatch.setattr(sc, "fetch_candles", fake_fetch)
    monkeypatch.setattr(sc, "analyze", fake_analyze)

    result = asyncio.run(sc.scan("tiny", side="all", limit=10))
    assert result["failed_count"] == 1
    assert result["analysed"] == 2
    assert [r["symbol"] for r in result["results"]] == ["AAA.NS", "CCC.NS"]

    bearish = asyncio.run(sc.scan("tiny", side="bearish", limit=10))
    assert [r["symbol"] for r in bearish["results"]] == ["CCC.NS"]


def test_scanner_rejects_unknown_universe():
    from app.services import liquidity_scanner as sc

    with pytest.raises(ValueError):
        asyncio.run(sc.scan("nope"))

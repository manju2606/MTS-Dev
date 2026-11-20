"""Unit tests for the Liquidity Flow engine. Pure Python, synthetic candles with known answers."""

import pytest

from app.domain.services.liquidity_flow.engine import (
    Candle,
    EngineConfig,
    analyze,
    detect_structure,
    detect_sweeps,
    find_pivots,
)

REQUIRED_KEYS = {
    "signal",
    "confidence",
    "entry_price",
    "stop_loss",
    "target",
    "risk_reward_ratio",
    "holding_period",
    "explanation",
}


def _series(rows):
    """rows: (open, high, low, close) tuples -> Candle list with 1-day spacing."""
    return [
        Candle(time=1_700_000_000 + i * 86400, open=o, high=h, low=lo, close=c, volume=1000.0)
        for i, (o, h, lo, c) in enumerate(rows)
    ]


def _flat(n, price=100.0):
    return [(price, price + 0.5, price - 0.5, price) for _ in range(n)]


def test_pivot_high_is_confirmed_only_after_right_side_closes():
    rows = [
        (10, 11, 9, 10),
        (10, 12, 9, 11),
        (11, 20, 10, 15),
        (15, 13, 10, 12),
        (12, 11, 9, 10),
        (10, 10, 8, 9),
    ]
    pivots = find_pivots(_series(rows), left=2, right=2)
    highs = [p for p in pivots if p.kind == "high"]
    assert len(highs) == 1
    assert highs[0].index == 2
    assert highs[0].confirm_index == 4  # 2 right-side candles needed
    assert highs[0].confirm_index > highs[0].index  # no look-ahead


def test_bullish_bos_when_close_breaks_last_swing_high():
    # Swing high at index 2 (price 20) confirmed at index 4. Index 6 closes above 20.
    rows = [
        (10, 11, 9, 10),
        (10, 12, 9, 11),
        (11, 20, 10, 15),
        (15, 13, 10, 12),
        (12, 11, 9, 10),
        (10, 14, 9, 13),
        (13, 22, 12, 21),
    ]
    candles = _series(rows)
    events, trend = detect_structure(candles, find_pivots(candles, 2, 2))
    assert events and events[0].kind == "BOS_UP"
    assert events[0].level == 20
    assert events[0].index == 6
    assert trend == "bullish"


# Shared prefix: swing high 20 (index 2), swing low 9 (index 4, strictly lowest of its window).
# Index 7 closes 21 above 20 -> BOS_UP with origin = swing low at index 4.
_STRUCTURE_PREFIX = [
    (10, 11, 9.5, 10),  # 0
    (10, 12, 9.8, 11),  # 1
    (11, 20, 10, 15),  # 2  swing high 20
    (15, 16, 10.5, 11),  # 3
    (11, 11.5, 9, 9.5),  # 4  swing low 9 (down candle)
    (9.5, 12, 9.2, 11.5),  # 5
    (11.5, 14, 9.4, 13.5),  # 6
    (13.5, 22, 13, 21),  # 7  BOS_UP through 20
    (21, 21.5, 18, 19),  # 8
    (19, 19.5, 13, 14),  # 9
]


def test_choch_when_bullish_trend_breaks_downward():
    candles = _series(
        _STRUCTURE_PREFIX
        + [
            (14, 15, 8, 8.5),  # 10: closes below swing low 9 -> CHoCH_DOWN
        ]
    )
    events, trend = detect_structure(candles, find_pivots(candles, 2, 2))
    kinds = [e.kind for e in events]
    assert kinds[0] == "BOS_UP"
    assert "CHOCH_DOWN" in kinds
    assert trend == "bearish"


def test_bullish_order_block_is_last_down_candle_before_impulse():
    candles = _series(_STRUCTURE_PREFIX)
    pivots = find_pivots(candles, 2, 2)
    events, _ = detect_structure(candles, pivots)
    from app.domain.services.liquidity_flow.engine import build_order_blocks

    blocks = build_order_blocks(candles, events, max_blocks=5)
    assert blocks, "expected a bullish order block"
    ob = blocks[0]
    assert ob.side == "bullish"
    assert ob.index == 4  # the only down-close candle inside the impulse
    assert ob.top == 11.5 and ob.bottom == 9
    assert ob.status == "active"


def test_buy_side_sweep_wicks_above_swing_high_and_closes_back_below():
    candles = _series(
        [
            (10, 11, 9, 10),
            (10, 12, 9, 11),
            (11, 20, 10, 15),
            (15, 13, 10, 12),
            (12, 11, 9, 10),
            (10, 12, 9, 11),
            (11, 21, 10, 12),  # wicks to 21 above swing high 20, closes at 12 below it
        ]
    )
    sweeps = detect_sweeps(candles, find_pivots(candles, 2, 2), lookback=10)
    assert any(s.side == "bearish" and s.index == 6 and s.level == 20 for s in sweeps)


def test_analyze_rejects_short_history():
    with pytest.raises(ValueError):
        analyze(_series(_flat(10)))


def test_analyze_returns_complete_recommendation_schema():
    # Gentle uptrend with noise so pivots exist.
    rows = []
    price = 100.0
    for i in range(80):
        drift = 0.4 * i
        wobble = 3.0 if i % 6 < 3 else -2.0
        p = price + drift + wobble
        rows.append((p - 0.5, p + 1.5, p - 1.5, p + 0.5))
    result = analyze(_series(rows), holding_period="1–5 sessions", cfg=EngineConfig())
    rec = result.recommendation
    assert REQUIRED_KEYS.issubset(rec)
    assert rec["signal"] in {"BUY", "SELL", "HOLD"}
    assert 0.0 <= rec["confidence"] <= 0.95
    assert rec["risk_reward_ratio"] >= 0
    assert rec["explanation"].strip()


def test_hold_downgrades_when_reward_to_risk_is_too_low():
    # Flat market: no structure, no sweep -> HOLD regardless of levels.
    result = analyze(_series(_flat(60)))
    assert result.recommendation["signal"] == "HOLD"
    assert result.recommendation["confidence"] < 0.30

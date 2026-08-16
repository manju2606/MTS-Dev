"""Unit tests for the MTS Silver Strategy risk gate -- pure functions over
already-fetched data, no database/broker session needed (see
app/domain/services/mcx_silver_risk_gate.py's own docstring)."""

from datetime import date, datetime

from app.domain.models.mcx_silver_risk_state import SilverRiskConfig
from app.domain.services.mcx_silver_risk_gate import (
    check_can_trade,
    compute_daily_state,
    is_expiry_protected,
    is_within_session,
)


def _closed(result: str, pnl: float) -> dict:
    return {"result": result, "pnl": pnl}


# ── compute_daily_state ──────────────────────────────────────────────────────


def test_compute_daily_state_empty():
    state = compute_daily_state([])
    assert state.trade_count == 0
    assert state.realized_pnl == 0.0
    assert state.consecutive_losses == 0


def test_compute_daily_state_sums_pnl_and_counts_trades():
    signals = [_closed("WIN", 500.0), _closed("LOSS", -200.0), _closed("WIN", 300.0)]
    state = compute_daily_state(signals)
    assert state.trade_count == 3
    assert state.realized_pnl == 600.0


def test_compute_daily_state_consecutive_losses_counts_trailing_streak_only():
    # WIN then two LOSSes -- streak is 2, the earlier WIN doesn't break it
    # from the wrong end.
    signals = [_closed("WIN", 100.0), _closed("LOSS", -50.0), _closed("LOSS", -50.0)]
    state = compute_daily_state(signals)
    assert state.consecutive_losses == 2


def test_compute_daily_state_streak_resets_on_trailing_win():
    signals = [_closed("LOSS", -50.0), _closed("LOSS", -50.0), _closed("WIN", 100.0)]
    state = compute_daily_state(signals)
    assert state.consecutive_losses == 0


def test_compute_daily_state_expired_breaks_streak_like_a_win():
    signals = [_closed("LOSS", -50.0), _closed("EXPIRED", 10.0)]
    state = compute_daily_state(signals)
    assert state.consecutive_losses == 0


# ── check_can_trade ───────────────────────────────────────────────────────────


def test_check_can_trade_allows_when_under_every_limit():
    cfg = SilverRiskConfig(capital=100_000.0)
    state = compute_daily_state([_closed("WIN", 500.0)])
    result = check_can_trade(state, cfg)
    assert result.can_trade is True
    assert result.reasons == []


def test_check_can_trade_blocks_at_max_trades_per_day():
    cfg = SilverRiskConfig(max_trades_per_day=3)
    signals = [_closed("WIN", 100.0)] * 3
    state = compute_daily_state(signals)
    result = check_can_trade(state, cfg)
    assert result.can_trade is False
    assert any("Max trades/day" in r for r in result.reasons)


def test_check_can_trade_blocks_at_max_consecutive_losses():
    cfg = SilverRiskConfig(max_consecutive_losses=2)
    signals = [_closed("LOSS", -100.0), _closed("LOSS", -100.0)]
    state = compute_daily_state(signals)
    result = check_can_trade(state, cfg)
    assert result.can_trade is False
    assert any("consecutive losses" in r for r in result.reasons)


def test_check_can_trade_blocks_at_daily_loss_limit():
    cfg = SilverRiskConfig(capital=100_000.0, max_daily_loss_pct=2.0)
    # -2000 is exactly the 2% limit on 100,000 capital.
    state = compute_daily_state([_closed("LOSS", -2000.0)])
    result = check_can_trade(state, cfg)
    assert result.can_trade is False
    assert any("Daily loss limit" in r for r in result.reasons)


def test_check_can_trade_does_not_block_on_profit_even_if_large():
    cfg = SilverRiskConfig(capital=100_000.0, max_daily_loss_pct=2.0)
    state = compute_daily_state([_closed("WIN", 50_000.0)])
    result = check_can_trade(state, cfg)
    assert result.can_trade is True


# ── is_within_session ─────────────────────────────────────────────────────────


def test_is_within_session_true_mid_session():
    cfg = SilverRiskConfig(
        session_start="09:00", session_end="23:30", avoid_first_minutes=15, avoid_last_minutes=15
    )
    now = datetime(2026, 8, 17, 14, 0)
    ok, _ = is_within_session(now, cfg)
    assert ok is True


def test_is_within_session_false_before_open():
    cfg = SilverRiskConfig(session_start="09:00", session_end="23:30")
    now = datetime(2026, 8, 17, 8, 0)
    ok, note = is_within_session(now, cfg)
    assert ok is False
    assert "outside" in note


def test_is_within_session_false_within_opening_buffer():
    cfg = SilverRiskConfig(session_start="09:00", session_end="23:30", avoid_first_minutes=15)
    now = datetime(2026, 8, 17, 9, 10)  # 10 min after open, buffer is 15
    ok, note = is_within_session(now, cfg)
    assert ok is False
    assert "first" in note


def test_is_within_session_false_within_closing_buffer():
    cfg = SilverRiskConfig(session_start="09:00", session_end="23:30", avoid_last_minutes=15)
    now = datetime(2026, 8, 17, 23, 20)  # 10 min before close, buffer is 15
    ok, note = is_within_session(now, cfg)
    assert ok is False
    assert "last" in note


# ── is_expiry_protected ────────────────────────────────────────────────────────


def test_is_expiry_protected_false_when_far_from_expiry():
    cfg = SilverRiskConfig(days_before_expiry_stop=5)
    blocked, note = is_expiry_protected(date(2026, 9, 30), datetime(2026, 8, 17), cfg)
    assert blocked is False
    assert "day(s) to expiry" in note


def test_is_expiry_protected_true_inside_window():
    cfg = SilverRiskConfig(days_before_expiry_stop=5)
    blocked, note = is_expiry_protected(date(2026, 8, 20), datetime(2026, 8, 17), cfg)
    assert blocked is True
    assert "expiry protection window" in note


def test_is_expiry_protected_true_on_expiry_day_itself():
    cfg = SilverRiskConfig(days_before_expiry_stop=5)
    blocked, _ = is_expiry_protected(date(2026, 8, 17), datetime(2026, 8, 17), cfg)
    assert blocked is True

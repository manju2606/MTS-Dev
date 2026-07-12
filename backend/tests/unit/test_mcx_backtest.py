"""Unit tests for mcx_backtest_service._stats_for/_group — the pure
aggregation logic behind the MCX AI signal-scorer backtest report."""

from app.services.mcx_backtest_service import _group, _stats_for


def _signal(contract: str, result: str, pnl: float | None, days: float = 1.0) -> dict:
    return {"contract": contract, "result": result, "pnl": pnl, "days_to_close": days}


def test_group_classifies_ng_and_metals_and_unknown():
    assert _group("NG") == "ng"
    assert _group("ng_aug") == "ng"
    assert _group("GOLD") == "metals"
    assert _group("SILVERMINI") == "metals"
    assert _group("NIFTY") == "other"


def test_stats_for_empty_returns_none_rates():
    stats = _stats_for([])
    assert stats["total_signals"] == 0
    assert stats["win_rate_pct"] is None
    assert stats["profit_factor"] is None
    assert stats["avg_pnl"] is None


def test_stats_for_win_rate_and_pnl():
    signals = [
        _signal("NG", "WIN", 5.0),
        _signal("NG", "WIN", 3.0),
        _signal("NG", "LOSS", -4.0),
    ]
    stats = _stats_for(signals)
    assert stats["total_signals"] == 3
    assert stats["resolved"] == 3
    assert stats["wins"] == 2
    assert stats["losses"] == 1
    assert stats["win_rate_pct"] == round(2 / 3 * 100, 1)
    assert stats["total_pnl"] == 4.0
    assert stats["avg_pnl"] == round(4.0 / 3, 2)


def test_stats_for_profit_factor():
    signals = [_signal("NG", "WIN", 10.0), _signal("NG", "LOSS", -5.0)]
    stats = _stats_for(signals)
    assert stats["profit_factor"] == 2.0


def test_stats_for_profit_factor_none_without_losses():
    signals = [_signal("NG", "WIN", 10.0)]
    stats = _stats_for(signals)
    assert stats["profit_factor"] is None


def test_stats_for_counts_expired_separately_from_resolved():
    signals = [_signal("NG", "WIN", 5.0), _signal("NG", "EXPIRED", -1.0)]
    stats = _stats_for(signals)
    assert stats["resolved"] == 1
    assert stats["expired"] == 1
    assert stats["total_signals"] == 2

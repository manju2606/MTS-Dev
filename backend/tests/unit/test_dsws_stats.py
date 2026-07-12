"""Unit tests for dsws_service._compute_stats — the pure aggregation function
shared by DSWS's own signal buckets and the other engines' resolved picks."""

from app.services.dsws_service import _compute_stats


def _entry(symbol: str, pct: float) -> dict:
    return {"symbol": symbol, "name": symbol, "scan_date": "2026-07-08", "pct_change": pct}


def test_empty_entries_returns_zeroed_stats():
    stats = _compute_stats([])
    assert stats == {
        "count": 0,
        "avg_return_pct": 0.0,
        "win_rate_pct": 0.0,
        "best": None,
        "worst": None,
        "entries": [],
    }


def test_avg_return_and_win_rate():
    entries = [_entry("A", 4.0), _entry("B", -2.0), _entry("C", 2.0)]
    stats = _compute_stats(entries)
    assert stats["count"] == 3
    assert stats["avg_return_pct"] == round((4.0 - 2.0 + 2.0) / 3, 2)
    assert stats["win_rate_pct"] == round(2 / 3 * 100, 1)


def test_best_and_worst_are_extremes():
    entries = [_entry("A", 4.0), _entry("B", -2.0), _entry("C", 9.5)]
    stats = _compute_stats(entries)
    assert stats["best"]["symbol"] == "C"
    assert stats["worst"]["symbol"] == "B"


def test_entries_sorted_best_to_worst():
    entries = [_entry("A", 1.0), _entry("B", -5.0), _entry("C", 3.0)]
    stats = _compute_stats(entries)
    assert [e["symbol"] for e in stats["entries"]] == ["C", "A", "B"]


def test_zero_wins_gives_zero_win_rate():
    entries = [_entry("A", -1.0), _entry("B", -2.0)]
    stats = _compute_stats(entries)
    assert stats["win_rate_pct"] == 0.0


def test_all_wins_gives_full_win_rate():
    entries = [_entry("A", 1.0), _entry("B", 2.0)]
    stats = _compute_stats(entries)
    assert stats["win_rate_pct"] == 100.0

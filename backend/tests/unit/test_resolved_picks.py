"""Unit tests for get_resolved_picks_between on the pick-generating engines'
repositories (BTST, Golden Stock, Stock of the Day).

These guard the two real bugs found while building the DSWS cross-engine
report: (1) filtering by scan_date instead of resolved_at made "today"
reports always empty, and (2) scan_time is already a full ISO datetime, so
concatenating it after scan_date produced an unparseable "selected_at".

A fake Motor-like collection stands in for MongoDB so these run without a
live database.
"""

from app.infra.db.repositories.btst_repo import BTSTRepository
from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository


class _FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for doc in self._docs:
            yield doc


class _FakeCollection:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def find(self, query=None, projection=None):
        return _FakeCursor(self._docs)


def _patch_col(monkeypatch, repo_cls, docs: list[dict]) -> None:
    monkeypatch.setattr(repo_cls, "_col", property(lambda self: _FakeCollection(docs)))


# ── BTST / Golden Stock (identical shape) ───────────────────────────────────


async def _run_scanner_repo_test(monkeypatch, repo_cls):
    docs = [
        {
            "scan_date": "2026-07-07",
            "scan_time": "2026-07-07T09:16:00.000000+05:30",
            "picks": [
                {
                    "symbol": "TITAN.NS",
                    "name": "Titan",
                    "outcome": "target_hit",
                    "actual_pct": 4.2,
                    "resolved_at": "2026-07-08T09:20:00",
                    "entry_price": 100.0,
                    "actual_close": 104.2,
                    "confidence_score": 80,
                },
                {
                    # unresolved pick — must be excluded
                    "symbol": "ITC.NS",
                    "name": "ITC",
                    "outcome": None,
                    "actual_pct": None,
                    "resolved_at": None,
                },
                {
                    # resolved, but outside the requested window — excluded
                    "symbol": "WIPRO.NS",
                    "name": "Wipro",
                    "outcome": "sl_hit",
                    "actual_pct": -3.5,
                    "resolved_at": "2026-06-20T09:20:00",
                    "entry_price": 50.0,
                    "actual_close": 48.25,
                    "confidence_score": 60,
                },
            ],
        }
    ]
    _patch_col(monkeypatch, repo_cls, docs)
    repo = repo_cls()

    entries = await repo.get_resolved_picks_between("2026-07-08", "2026-07-08")

    assert len(entries) == 1
    entry = entries[0]
    assert entry["symbol"] == "TITAN.NS"
    assert entry["scan_date"] == "2026-07-08"  # resolved_date, not scan_date
    assert entry["pct_change"] == 4.2
    # regression guard: selected_at must be the raw scan_time, not scan_date+scan_time
    assert entry["selected_at"] == "2026-07-07T09:16:00.000000+05:30"
    assert entry["entry_price"] == 100.0
    assert entry["current_price"] == 104.2
    assert entry["forecast"] == "UP"
    assert entry["ai_score"] == 80


async def test_btst_get_resolved_picks_between(monkeypatch):
    await _run_scanner_repo_test(monkeypatch, BTSTRepository)


async def test_golden_stock_get_resolved_picks_between(monkeypatch):
    await _run_scanner_repo_test(monkeypatch, GoldenStockRepository)


async def test_btst_falls_back_to_scan_date_when_scan_time_missing(monkeypatch):
    docs = [
        {
            "scan_date": "2026-07-07",
            "picks": [
                {
                    "symbol": "TITAN.NS",
                    "name": "Titan",
                    "outcome": "target_hit",
                    "actual_pct": 1.0,
                    "resolved_at": "2026-07-08T09:20:00",
                    "entry_price": 100.0,
                    "actual_close": 101.0,
                    "confidence_score": 70,
                },
            ],
        }
    ]
    _patch_col(monkeypatch, BTSTRepository, docs)
    entries = await BTSTRepository().get_resolved_picks_between("2026-07-08", "2026-07-08")
    assert entries[0]["selected_at"] == "2026-07-07"


# ── Stock of the Day ─────────────────────────────────────────────────────────


async def test_stock_of_day_get_resolved_picks_between(monkeypatch):
    docs = [
        {
            "symbol": "SUNPHARMA.NS",
            "name": "Sun Pharma",
            "date": "2026-07-08",
            "pnl_pct": 2.5,
            "generated_at": "2026-07-08T03:45:00",
            "entry_price": 1500.0,
            "exit_price": 1537.5,
            "forecast_direction": "UP",
            "composite_score": 88.0,
        },
    ]
    _patch_col(monkeypatch, StockOfDayRepository, docs)
    entries = await StockOfDayRepository().get_resolved_picks_between("2026-07-08", "2026-07-08")

    assert len(entries) == 1
    entry = entries[0]
    assert entry["symbol"] == "SUNPHARMA.NS"
    assert entry["selected_at"] == "2026-07-08T03:45:00"
    assert entry["entry_price"] == 1500.0
    assert entry["current_price"] == 1537.5
    assert entry["forecast"] == "UP"
    assert entry["ai_score"] == 88.0


async def test_stock_of_day_defaults_when_fields_missing(monkeypatch):
    docs = [
        {
            "symbol": "SUNPHARMA.NS",
            "date": "2026-07-08",
            "pnl_pct": -1.0,
        },
    ]
    _patch_col(monkeypatch, StockOfDayRepository, docs)
    entries = await StockOfDayRepository().get_resolved_picks_between("2026-07-08", "2026-07-08")

    entry = entries[0]
    assert entry["name"] == "SUNPHARMA.NS"  # falls back to symbol
    assert entry["selected_at"] == "2026-07-08"  # falls back to date
    assert entry["entry_price"] is None
    assert entry["current_price"] is None
    assert entry["forecast"] == "N/A"
    assert entry["ai_score"] == 0

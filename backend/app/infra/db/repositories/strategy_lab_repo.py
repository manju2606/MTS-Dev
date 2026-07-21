"""MongoDB repository for AI Strategy Lab runs and results.

Collections:
  strategy_lab_runs    -- one document per generation+backtest run
  strategy_lab_results -- one document per generated strategy's full
                          backtest+walk-forward+ranking output for a run
"""

from __future__ import annotations

import dataclasses

import motor.motor_asyncio

from app.core.config import settings
from app.domain.models.strategy_lab import (
    BacktestMetrics,
    IndexScanRun,
    StrategyCandidate,
    StrategyLabResult,
    StrategyLabRun,
    SymbolSweepRun,
    TradeRecord,
    WalkForwardSplit,
)

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class StrategyLabRepository:
    @property
    def _runs(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["strategy_lab_runs"]

    @property
    def _results(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["strategy_lab_results"]

    @property
    def _index_scans(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["strategy_lab_index_scans"]

    @property
    def _symbol_sweeps(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["strategy_lab_symbol_sweeps"]

    async def ensure_indexes(self) -> None:
        await self._runs.create_index([("id", 1)], unique=True)
        await self._runs.create_index([("user_id", 1), ("created_at", -1)])
        await self._results.create_index([("id", 1)], unique=True)
        await self._results.create_index([("run_id", 1), ("composite_score", -1)])
        await self._index_scans.create_index([("id", 1)], unique=True)
        await self._index_scans.create_index([("user_id", 1), ("created_at", -1)])
        await self._symbol_sweeps.create_index([("id", 1)], unique=True)
        await self._symbol_sweeps.create_index([("user_id", 1), ("created_at", -1)])

    # ── Runs ─────────────────────────────────────────────────────────────────

    async def create_run(self, run: StrategyLabRun) -> None:
        await self._runs.insert_one(dataclasses.asdict(run))

    async def update_run(self, run_id: str, **fields: object) -> None:
        await self._runs.update_one({"id": run_id}, {"$set": fields})

    async def get_run(self, run_id: str) -> StrategyLabRun | None:
        doc = await self._runs.find_one({"id": run_id}, {"_id": 0})
        return StrategyLabRun(**doc) if doc else None

    # Fields a caller may sort Past Runs by -- "score" maps to the
    # denormalized best_composite_score (see StrategyLabRun's own docstring
    # on why it's stored on the run instead of a join/lookup at read time).
    RUN_SORT_FIELDS = {
        "created_at": "created_at",
        "score": "best_composite_score",
        "symbol": "symbol",
        "status": "status",
    }

    async def list_runs(
        self, user_id: str, limit: int = 20, offset: int = 0, sort_by: str = "created_at", sort_dir: int = -1,
    ) -> list[StrategyLabRun]:
        field = self.RUN_SORT_FIELDS.get(sort_by, "created_at")
        cursor = (
            self._runs.find({"user_id": user_id}, {"_id": 0})
            .sort([(field, sort_dir), ("created_at", -1)])
            .skip(offset)
            .limit(limit)
        )
        return [StrategyLabRun(**doc) async for doc in cursor]

    async def count_runs(self, user_id: str) -> int:
        return await self._runs.count_documents({"user_id": user_id})

    # Every completed run (any family -- generated/trend_pullback/orb/
    # rsi_reversion, including an Index Scan's per-symbol child runs, which
    # are ordinary StrategyLabRun docs with a real symbol) that has a
    # denormalized best_composite_score, ranked highest-first -- reuses
    # best_candidate_name/best_composite_score (already written once at
    # completion for Past Runs) rather than a new results join. Returns
    # every match rather than filtering by symbol in Mongo: an MCX run's
    # `symbol` field is the literal resolved Kite tradingsymbol (e.g.
    # "NATGASMINI26JULFUT"), which rolls to a different string every month,
    # so per-instrument grouping has to happen in Python against a stable
    # family key -- see strategy_lab_service._symbol_family_key.
    async def list_completed_scored_runs(self, user_id: str) -> list[StrategyLabRun]:
        cursor = (
            self._runs.find(
                {"user_id": user_id, "status": "completed", "best_composite_score": {"$ne": None}},
                {"_id": 0},
            )
            .sort("best_composite_score", -1)
        )
        return [StrategyLabRun(**doc) async for doc in cursor]

    # ── Results ──────────────────────────────────────────────────────────────

    async def save_result(self, result: StrategyLabResult) -> None:
        await self._results.insert_one(dataclasses.asdict(result))

    async def list_results(self, run_id: str, limit: int = 500) -> list[dict]:
        """Lean summary projection for the ranked results table -- omits the
        heavy trades/equity_curve/drawdown_curve arrays."""
        cursor = (
            self._results.find(
                {"run_id": run_id},
                {
                    "_id": 0,
                    "id": 1,
                    "candidate": 1,
                    "full_metrics": 1,
                    "walk_forward.stability_score": 1,
                    "composite_score": 1,
                },
            )
            .sort("composite_score", -1)
            .limit(limit)
        )
        return [doc async for doc in cursor]

    async def get_result(self, result_id: str) -> StrategyLabResult | None:
        doc = await self._results.find_one({"id": result_id}, {"_id": 0})
        if not doc:
            return None
        return StrategyLabResult(
            id=doc["id"],
            run_id=doc["run_id"],
            candidate=StrategyCandidate(**doc["candidate"]),
            full_metrics=BacktestMetrics(**doc["full_metrics"]),
            walk_forward=WalkForwardSplit(
                train_metrics=BacktestMetrics(**doc["walk_forward"]["train_metrics"]),
                test_metrics=BacktestMetrics(**doc["walk_forward"]["test_metrics"]),
                stability_score=doc["walk_forward"]["stability_score"],
            ),
            composite_score=doc["composite_score"],
            equity_curve=doc["equity_curve"],
            drawdown_curve=doc["drawdown_curve"],
            trades=[TradeRecord(**t) for t in doc["trades"]],
        )

    # ── Index scans ──────────────────────────────────────────────────────────

    async def create_index_scan(self, scan: IndexScanRun) -> None:
        await self._index_scans.insert_one(dataclasses.asdict(scan))

    async def update_index_scan(self, scan_id: str, **fields: object) -> None:
        await self._index_scans.update_one({"id": scan_id}, {"$set": fields})

    async def get_index_scan(self, scan_id: str) -> IndexScanRun | None:
        doc = await self._index_scans.find_one({"id": scan_id}, {"_id": 0})
        return IndexScanRun(**doc) if doc else None

    async def list_index_scans(self, user_id: str, limit: int = 20) -> list[IndexScanRun]:
        cursor = (
            self._index_scans.find({"user_id": user_id}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        return [IndexScanRun(**doc) async for doc in cursor]

    # ── Symbol sweeps (inverse of index scans -- every strategy, one symbol) ─

    async def create_symbol_sweep(self, sweep: SymbolSweepRun) -> None:
        await self._symbol_sweeps.insert_one(dataclasses.asdict(sweep))

    async def update_symbol_sweep(self, sweep_id: str, **fields: object) -> None:
        await self._symbol_sweeps.update_one({"id": sweep_id}, {"$set": fields})

    async def get_symbol_sweep(self, sweep_id: str) -> SymbolSweepRun | None:
        doc = await self._symbol_sweeps.find_one({"id": sweep_id}, {"_id": 0})
        return SymbolSweepRun(**doc) if doc else None

    async def list_symbol_sweeps(self, user_id: str, limit: int = 20) -> list[SymbolSweepRun]:
        cursor = (
            self._symbol_sweeps.find({"user_id": user_id}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        return [SymbolSweepRun(**doc) async for doc in cursor]

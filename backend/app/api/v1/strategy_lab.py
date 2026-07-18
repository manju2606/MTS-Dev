"""AI Strategy Lab API — kick off auto-generated strategy backtest runs,
poll their progress, and browse ranked results. See
services/strategy_lab_service.py for the orchestration and
domain/services/strategy_lab/ for generation/backtest/ranking logic."""

import dataclasses

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.infra.db.repositories.strategy_lab_repo import StrategyLabRepository
from app.services import strategy_lab_service

router = APIRouter(prefix="/strategy-lab", tags=["strategy-lab"])

_INTERVALS = {"minute", "3minute", "5minute", "10minute", "15minute", "30minute", "60minute", "day"}
_EXCHANGES = {"NSE", "BSE", "NFO", "MCX"}


class StartRunRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    interval: str = "day"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    capital: float = 100_000.0


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def start_run(body: StartRunRequest, current_user: CurrentUser) -> dict:
    if body.exchange.upper() not in _EXCHANGES:
        raise HTTPException(status_code=422, detail=f"exchange must be one of {sorted(_EXCHANGES)}")
    if body.interval not in _INTERVALS:
        raise HTTPException(status_code=422, detail=f"interval must be one of {sorted(_INTERVALS)}")
    if body.capital <= 0:
        raise HTTPException(status_code=422, detail="capital must be positive")

    run_id = await strategy_lab_service.start_run(
        user_id=str(current_user.id),
        symbol=body.symbol.strip().upper(),
        exchange=body.exchange.upper(),
        interval=body.interval,
        from_date=body.from_date,
        to_date=body.to_date,
        capital=body.capital,
    )
    return {"run_id": run_id}


class StartIndexScanRequest(BaseModel):
    index: str = "NIFTY50"
    interval: str = "day"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    capital: float = 100_000.0


@router.get("/index-scan/universes")
async def list_index_universes(current_user: CurrentUser) -> list[dict]:
    """The exchange each index universe requires -- e.g. NIFTY50 is NSE,
    MCX_ALL is MCX. The frontend uses this to lock/display the right
    exchange per index instead of letting a mismatched one be picked."""
    return [
        {"index": key, "exchange": u.exchange, "symbol_count": len(u.symbols)}
        for key, u in strategy_lab_service.INDEX_UNIVERSES.items()
    ]


@router.post("/index-scan", status_code=status.HTTP_202_ACCEPTED)
async def start_index_scan(body: StartIndexScanRequest, current_user: CurrentUser) -> dict:
    """Runs the full auto-generated 392-candidate sweep against every symbol
    in an index universe, one full run per symbol, processed sequentially --
    see strategy_lab_service.start_index_scan_run and INDEX_UNIVERSES. The
    exchange is derived from the index itself (not caller-supplied), so
    there's no way to request e.g. NIFTY50 against the wrong exchange."""
    if body.interval not in _INTERVALS:
        raise HTTPException(status_code=422, detail=f"interval must be one of {sorted(_INTERVALS)}")
    if body.capital <= 0:
        raise HTTPException(status_code=422, detail="capital must be positive")

    try:
        scan_id = await strategy_lab_service.start_index_scan_run(
            user_id=str(current_user.id),
            index=body.index.strip().upper(),
            interval=body.interval,
            from_date=body.from_date,
            to_date=body.to_date,
            capital=body.capital,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"scan_id": scan_id}


@router.get("/index-scan")
async def list_index_scans(current_user: CurrentUser) -> list[dict]:
    repo = StrategyLabRepository()
    scans = await repo.list_index_scans(str(current_user.id))
    return [dataclasses.asdict(s) for s in scans]


@router.get("/index-scan/{scan_id}")
async def get_index_scan(scan_id: str, current_user: CurrentUser) -> dict:
    repo = StrategyLabRepository()
    scan = await repo.get_index_scan(scan_id)
    if scan is None or scan.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Index scan not found")
    return dataclasses.asdict(scan)


@router.get("/index-scan/{scan_id}/ranking")
async def get_index_scan_ranking(scan_id: str, current_user: CurrentUser) -> list[dict]:
    """Best (top composite_score) result per symbol scanned so far, ranked
    across the whole index -- safe to poll while the scan is still running
    for a live-updating leaderboard."""
    repo = StrategyLabRepository()
    scan = await repo.get_index_scan(scan_id)
    if scan is None or scan.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Index scan not found")
    return await strategy_lab_service.get_index_scan_ranking(scan_id)


class StartTrendPullbackRequest(BaseModel):
    symbol: str
    exchange: str = "MCX"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    capital: float = 100_000.0
    version: str = "v1.0"  # "v1.0" (original) | "v2.0" (tightened ADX/stop/pullback)


@router.post("/runs/trend-pullback", status_code=status.HTTP_202_ACCEPTED)
async def start_trend_pullback_run(
    body: StartTrendPullbackRequest, current_user: CurrentUser
) -> dict:
    """The hand-designed Trend Pullback strategy: 5-min execution with a 1H
    200 EMA trend filter. Fixed logic per version (not parameter-swept like
    /runs), see strategy_lab_service.start_trend_pullback_run and
    trend_pullback.TREND_PULLBACK_VERSIONS."""
    if body.exchange.upper() not in _EXCHANGES:
        raise HTTPException(status_code=422, detail=f"exchange must be one of {sorted(_EXCHANGES)}")
    if body.capital <= 0:
        raise HTTPException(status_code=422, detail="capital must be positive")

    try:
        run_id = await strategy_lab_service.start_trend_pullback_run(
            user_id=str(current_user.id),
            symbol=body.symbol.strip().upper(),
            exchange=body.exchange.upper(),
            from_date=body.from_date,
            to_date=body.to_date,
            capital=body.capital,
            version=body.version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"run_id": run_id}


class StartOrbRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    interval: str = "5minute"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    capital: float = 100_000.0


@router.post("/runs/opening-range-breakout", status_code=status.HTTP_202_ACCEPTED)
async def start_orb_run(body: StartOrbRequest, current_user: CurrentUser) -> dict:
    """The hand-designed Opening Range Breakout strategy: 09:00-09:30 range,
    breakout-above-high-with-volume entry, stop at range low, 2xATR target,
    one trade/day with EOD square-off. Fixed logic, see
    strategy_lab_service.start_orb_run."""
    if body.exchange.upper() not in _EXCHANGES:
        raise HTTPException(status_code=422, detail=f"exchange must be one of {sorted(_EXCHANGES)}")
    if body.interval not in _INTERVALS:
        raise HTTPException(status_code=422, detail=f"interval must be one of {sorted(_INTERVALS)}")
    if body.capital <= 0:
        raise HTTPException(status_code=422, detail="capital must be positive")

    run_id = await strategy_lab_service.start_orb_run(
        user_id=str(current_user.id),
        symbol=body.symbol.strip().upper(),
        exchange=body.exchange.upper(),
        interval=body.interval,
        from_date=body.from_date,
        to_date=body.to_date,
        capital=body.capital,
    )
    return {"run_id": run_id}


class StartRsiReversionRequest(BaseModel):
    symbol: str
    exchange: str = "MCX"
    from_date: str  # "YYYY-MM-DD"
    to_date: str  # "YYYY-MM-DD"
    capital: float = 100_000.0
    version: str = "v1.0"  # "v1.0" (long-only) | "v2.0" (adds a symmetric short leg)


@router.post("/runs/rsi-reversion", status_code=status.HTTP_202_ACCEPTED)
async def start_rsi_reversion_run(body: StartRsiReversionRequest, current_user: CurrentUser) -> dict:
    """The hand-designed RSI-14 Reversion strategy (oversold=20/overbought=80,
    SL 2.5%/target 5.0%/trailing stop 2.0%, 5-min candles) -- the AI Strategy
    Lab's #1 ranked, walk-forward-validated candidate for Natural Gas Mini,
    also deployed live (see the MCX page's RSI Strategy tab). v1.0 is that
    exact long-only logic; v2.0 adds a symmetric short leg. Fixed logic per
    version, see strategy_lab_service.start_rsi_reversion_run and
    rsi_reversion_v2.RSI_REVERSION_VERSIONS."""
    if body.exchange.upper() not in _EXCHANGES:
        raise HTTPException(status_code=422, detail=f"exchange must be one of {sorted(_EXCHANGES)}")
    if body.capital <= 0:
        raise HTTPException(status_code=422, detail="capital must be positive")

    try:
        run_id = await strategy_lab_service.start_rsi_reversion_run(
            user_id=str(current_user.id),
            symbol=body.symbol.strip().upper(),
            exchange=body.exchange.upper(),
            from_date=body.from_date,
            to_date=body.to_date,
            capital=body.capital,
            version=body.version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"run_id": run_id}


@router.get("/runs")
async def list_runs(
    current_user: CurrentUser, limit: int = 20, offset: int = 0,
    sort_by: str = "created_at", sort_dir: int = -1,
) -> dict:
    """Paginated -- an Index Scan alone creates one run per symbol (50 for
    NIFTY 50), so the old flat unpaginated list (fixed limit=20) silently
    hid everything past the 20 most recent runs. `total` lets the frontend
    show/hide a "Load more" control without a second count call. sort_by is
    one of StrategyLabRepository.RUN_SORT_FIELDS ("created_at" | "score" |
    "symbol" | "status"); sort_dir is 1 (ascending) or -1 (descending)."""
    if sort_by not in StrategyLabRepository.RUN_SORT_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"sort_by must be one of {sorted(StrategyLabRepository.RUN_SORT_FIELDS)}",
        )
    if sort_dir not in (1, -1):
        raise HTTPException(status_code=422, detail="sort_dir must be 1 or -1")

    repo = StrategyLabRepository()
    runs = await repo.list_runs(
        str(current_user.id), limit=limit, offset=offset, sort_by=sort_by, sort_dir=sort_dir,
    )
    total = await repo.count_runs(str(current_user.id))
    return {"runs": [dataclasses.asdict(r) for r in runs], "total": total}


@router.get("/compare/{symbol}")
async def compare_symbol_strategies(symbol: str, current_user: CurrentUser, limit: int = 10) -> dict:
    """Top `limit` completed backtest runs for `symbol` (any strategy
    family/version), ranked by composite score -- "which strategy is
    actually best for this instrument" across everything ever run, not
    just the most recent attempt. See strategy_lab_service.get_symbol_comparison."""
    return await strategy_lab_service.get_symbol_comparison(str(current_user.id), symbol, limit)


@router.get("/runs/{run_id}")
async def get_run(run_id: str, current_user: CurrentUser) -> dict:
    repo = StrategyLabRepository()
    run = await repo.get_run(run_id)
    if run is None or run.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Run not found")
    return dataclasses.asdict(run)


@router.get("/runs/{run_id}/results")
async def list_results(run_id: str, current_user: CurrentUser) -> list[dict]:
    repo = StrategyLabRepository()
    run = await repo.get_run(run_id)
    if run is None or run.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Run not found")
    return await repo.list_results(run_id)


@router.get("/runs/{run_id}/results/{result_id}")
async def get_result(run_id: str, result_id: str, current_user: CurrentUser) -> dict:
    repo = StrategyLabRepository()
    run = await repo.get_run(run_id)
    if run is None or run.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Run not found")
    result = await repo.get_result(result_id)
    if result is None or result.run_id != run_id:
        raise HTTPException(status_code=404, detail="Result not found")
    return dataclasses.asdict(result)


@router.get("/runs/{run_id}/results/{result_id}/monte-carlo")
async def get_result_monte_carlo(
    run_id: str, result_id: str, current_user: CurrentUser,
    simulations: int = 2000, ruin_threshold_pct: float = 50.0,
) -> dict:
    """Bootstrap-resamples this result's own trade returns thousands of
    times to build a distribution of possible outcomes -- works for any
    completed backtest result (generated sweep, Trend Pullback, ORB, RSI
    Reversion, an Index Scan symbol's result), not just RSI, since it only
    needs the trade list already stored on the result. See
    domain/services/strategy_lab/monte_carlo.py."""
    from app.domain.services.strategy_lab.monte_carlo import run_monte_carlo

    if simulations < 100 or simulations > 20_000:
        raise HTTPException(status_code=422, detail="simulations must be between 100 and 20000")
    if not 1.0 <= ruin_threshold_pct <= 99.0:
        raise HTTPException(status_code=422, detail="ruin_threshold_pct must be between 1 and 99")

    repo = StrategyLabRepository()
    run = await repo.get_run(run_id)
    if run is None or run.user_id != str(current_user.id):
        raise HTTPException(status_code=404, detail="Run not found")
    result = await repo.get_result(result_id)
    if result is None or result.run_id != run_id:
        raise HTTPException(status_code=404, detail="Result not found")

    mc = run_monte_carlo(
        result.trades, run.capital, num_simulations=simulations, ruin_threshold_pct=ruin_threshold_pct,
    )
    if mc is None:
        raise HTTPException(
            status_code=422,
            detail=f"Not enough trades for a meaningful Monte Carlo simulation "
                   f"(need at least 10, this result has {len(result.trades)})",
        )
    return dataclasses.asdict(mc)

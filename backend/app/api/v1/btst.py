"""BTST (Buy Today, Sell Tomorrow) API routes."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/btst", tags=["btst"])

_admin_only = Depends(require_role(UserRole.ADMIN))


async def _fetch_ltp_map(symbols: list[str]) -> dict[str, float]:
    """Batch-fetch live prices for a list of NSE/BSE symbols."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    unique = sorted({s for s in symbols if s})
    if not unique:
        return {}
    client = YFinanceClient()
    results = await asyncio.gather(
        *[client.get_quote(sym) for sym in unique], return_exceptions=True
    )
    return {
        sym: r.price
        for sym, r in zip(unique, results, strict=True)
        if not isinstance(r, Exception)
    }


def _attach_pnl(target: dict, ltp: float | None, entry: float | None) -> None:
    target["ltp"] = ltp
    if ltp is not None and entry:
        target["pnl_amount"] = round(ltp - entry, 2)
        target["pnl_pct"] = round((ltp - entry) / entry * 100, 2)
    else:
        target["pnl_amount"] = None
        target["pnl_pct"] = None


async def _attach_pnl_to_picks(picks: list[dict]) -> None:
    ltp_map = await _fetch_ltp_map([p.get("symbol", "") for p in picks])
    for p in picks:
        _attach_pnl(p, ltp_map.get(p.get("symbol", "")), p.get("entry_price"))


@router.get("/latest")
async def get_latest(_: CurrentUser) -> dict:
    """Return the most recent BTST scan, or 404 if none exists yet."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    doc = await repo.get_latest_scan()
    if doc is None:
        raise HTTPException(status_code=404, detail="No BTST scan found. Run a scan first.")
    await _attach_pnl_to_picks(doc.get("picks", []))
    return doc


@router.get("/history")
async def get_history(
    _: CurrentUser,
    limit: int = Query(default=30, ge=1, le=100),
) -> list[dict]:
    """Return metadata for recent BTST scans (no picks detail), most recent first."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    rows = await repo.get_history(limit=limit)
    ltp_map = await _fetch_ltp_map([r.get("top_symbol", "") for r in rows])
    for r in rows:
        ltp = ltp_map.get(r.get("top_symbol", ""))
        r["top_ltp"] = ltp
        entry = r.get("top_entry_price")
        if ltp is not None and entry:
            r["top_pnl_amount"] = round(ltp - entry, 2)
            r["top_pnl_pct"] = round((ltp - entry) / entry * 100, 2)
        else:
            r["top_pnl_amount"] = None
            r["top_pnl_pct"] = None
    return rows


@router.get("/history/{date_str}")
async def get_scan_by_date(date_str: str, _: CurrentUser) -> dict:
    """Return the full BTST scan document for a specific date (YYYY-MM-DD)."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    doc = await repo.get_scan_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No BTST scan found for date {date_str}")
    await _attach_pnl_to_picks(doc.get("picks", []))
    return doc


@router.post("/scan", dependencies=[_admin_only])
async def trigger_scan(_: CurrentUser) -> dict:
    """Manually trigger a BTST scan (admin only). Runs the full scan pipeline."""
    import dataclasses

    from app.services.btst_service import run_and_save_btst

    scan = await run_and_save_btst()
    doc = dataclasses.asdict(scan)
    await _attach_pnl_to_picks(doc.get("picks", []))
    return doc


@router.get("/performance")
async def get_performance(_: CurrentUser) -> dict:
    """Return accuracy statistics for resolved BTST picks (hit rate, avg return)."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    return await repo.get_performance_stats()

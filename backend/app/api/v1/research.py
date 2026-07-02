"""Market research agent — scans Nifty indices and returns ranked candidates."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser
from app.infra.scanner.universe import NIFTY_INDICES
from app.infra.scanner.market_scanner import scan

router = APIRouter(prefix="/research", tags=["research-agent"])


@router.get("/scan")
async def market_scan(
    current_user: CurrentUser,
    filter_type: str = Query(default="both", pattern="^(momentum|value|both)$"),
    universe: str = Query(default="nifty50"),
    limit: int = Query(default=20, ge=5, le=50),
) -> list[dict]:
    if universe not in NIFTY_INDICES:
        raise HTTPException(
            status_code=422,
            detail=f"universe must be one of: {', '.join(NIFTY_INDICES)}",
        )
    symbols = NIFTY_INDICES[universe]["symbols"]
    results = await scan(universe=symbols, filter_type=filter_type, limit=limit)
    return [asdict(r) for r in results]


@router.get("/universe")
async def get_universe(current_user: CurrentUser) -> dict:
    return {
        key: {
            "label": idx["label"],
            "cap": idx["cap"],
            "count": len(idx["symbols"]),
        }
        for key, idx in NIFTY_INDICES.items()
    }

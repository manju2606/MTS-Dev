"""Market research agent — scans Nifty 50+Next50 and returns ranked candidates."""

from dataclasses import asdict

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser
from app.infra.scanner.market_scanner import NIFTY_50, NIFTY_NEXT_50_SAMPLE, scan

router = APIRouter(prefix="/research", tags=["research-agent"])


@router.get("/scan")
async def market_scan(
    current_user: CurrentUser,
    filter_type: str = Query(default="both", pattern="^(momentum|value|both)$"),
    universe: str = Query(default="nifty50", pattern="^(nifty50|nifty100)$"),
    limit: int = Query(default=20, ge=5, le=50),
) -> list[dict]:
    symbols = NIFTY_50 if universe == "nifty50" else NIFTY_50 + NIFTY_NEXT_50_SAMPLE
    results = await scan(universe=symbols, filter_type=filter_type, limit=limit)
    return [asdict(r) for r in results]


@router.get("/universe")
async def get_universe(current_user: CurrentUser) -> dict:
    return {
        "nifty50": {"symbols": NIFTY_50, "count": len(NIFTY_50)},
        "nifty100": {
            "symbols": NIFTY_50 + NIFTY_NEXT_50_SAMPLE,
            "count": len(NIFTY_50) + len(NIFTY_NEXT_50_SAMPLE),
        },
    }

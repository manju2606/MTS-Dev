"""Cross-instrument correlation across MCX contracts -- see
app/services/mcx_correlation_service.py."""

from fastapi import APIRouter

from app.api.deps import CurrentUser

router = APIRouter(prefix="/mcx/correlation", tags=["mcx"])


@router.get("/")
async def mcx_correlation(
    current_user: CurrentUser,
    contracts: str = "GOLDGUINEA,SILVER100,NGMINI",
    days: int = 30,
) -> dict:
    """Pearson correlation matrix of 5-minute-candle returns between the
    given MCX contracts (comma-separated) over the trailing `days`."""
    from app.services.mcx_correlation_service import compute_mcx_correlation

    contract_list = [c.strip().upper() for c in contracts.split(",") if c.strip()]
    return await compute_mcx_correlation(contract_list, days=days)

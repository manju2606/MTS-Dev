from fastapi import APIRouter

from app.api.v1 import (
    admin,
    ai,
    alerts,
    auth,
    backtest,
    broker,
    dashboard,
    discovery,
    forecast,
    journal,
    live,
    market_pulse,
    market_sources,
    ml_api,
    paper,
    portfolio,
    research,
    risk,
    scanner,
    stock_of_day,
    usage,
)

router = APIRouter()


@router.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


router.include_router(auth.router)
router.include_router(scanner.router)
router.include_router(paper.router)
router.include_router(ai.router)
router.include_router(risk.router)
router.include_router(backtest.router)
router.include_router(broker.router)
router.include_router(live.router)
router.include_router(ml_api.router)
router.include_router(admin.router)
router.include_router(research.router)
router.include_router(market_pulse.router)
router.include_router(portfolio.router)
router.include_router(alerts.router)
router.include_router(journal.router)
router.include_router(usage.router)
router.include_router(dashboard.router)
router.include_router(discovery.router)
router.include_router(forecast.router)
router.include_router(stock_of_day.router)
router.include_router(market_sources.router)

from fastapi import APIRouter

from app.api.v1 import admin, ai, auth, backtest, broker, live, ml_api, paper, risk, scanner

router = APIRouter()
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

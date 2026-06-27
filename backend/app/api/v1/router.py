from fastapi import APIRouter

from app.api.v1 import ai, auth, backtest, paper, risk, scanner

router = APIRouter()
router.include_router(auth.router)
router.include_router(scanner.router)
router.include_router(paper.router)
router.include_router(ai.router)
router.include_router(risk.router)
router.include_router(backtest.router)

from fastapi import APIRouter

from app.api.v1 import auth, paper, scanner

router = APIRouter()
router.include_router(auth.router)
router.include_router(scanner.router)
router.include_router(paper.router)

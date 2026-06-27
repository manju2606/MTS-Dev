from fastapi import APIRouter

from app.api.v1 import auth, scanner

router = APIRouter()
router.include_router(auth.router)
router.include_router(scanner.router)

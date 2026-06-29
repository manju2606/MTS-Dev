import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import router as api_v1_router
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import configure_logging
from app.core.security import decode_token
from app.infra.market_data.yfinance_client import YFinanceClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    if settings.ENVIRONMENT != "testing":
        from app.core.scheduler import start_scheduler
        start_scheduler()
    yield
    if settings.ENVIRONMENT != "testing":
        from app.core.scheduler import stop_scheduler
        stop_scheduler()


app = FastAPI(
    title="Manju Trade AI Pro",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/prices")
async def price_stream(websocket: WebSocket, token: str, symbols: str):
    """Stream live prices every 5 s for a comma-separated symbol list."""
    try:
        payload = decode_token(token)
        UUID(payload["sub"])
    except Exception:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    client = YFinanceClient()
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]

    try:
        while True:
            results = await asyncio.gather(
                *[client.get_quote(s) for s in sym_list], return_exceptions=True
            )
            payload_data = {}
            for sym, r in zip(sym_list, results, strict=True):
                if not isinstance(r, Exception):
                    payload_data[sym] = {
                        "symbol": r.symbol,
                        "price": r.price,
                        "change": r.change,
                        "change_pct": r.change_pct,
                        "volume": r.volume,
                        "day_high": r.day_high,
                        "day_low": r.day_low,
                        "prev_close": r.prev_close,
                    }
            await websocket.send_json(payload_data)
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

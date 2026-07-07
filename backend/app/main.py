import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import router as api_v1_router
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import configure_logging
from app.core.security import decode_token
from app.core.sentry import init_sentry
from app.infra.market_data.yfinance_client import YFinanceClient

# Called before the FastAPI app is created so Sentry's Starlette/FastAPI
# integrations can patch things before the app object exists. No-ops if
# SENTRY_DSN isn't set.
init_sentry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    if settings.ENVIRONMENT != "testing":
        from app.core.scheduler import start_scheduler, try_acquire_scheduler_lock

        # Only one worker process should run the cron jobs — otherwise every
        # scheduled job (reports, scans, position checks, ...) fires once per
        # uvicorn worker.
        if await try_acquire_scheduler_lock():
            start_scheduler()
    yield
    if settings.ENVIRONMENT != "testing":
        from app.core.scheduler import release_scheduler_lock, stop_scheduler

        stop_scheduler()
        await release_scheduler_lock()


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


@app.middleware("http")
async def audit_middleware(request, call_next):
    """Log non-GET mutating API calls to the audit trail."""
    response = await call_next(request)
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and request.url.path.startswith("/api/v1/")
        and response.status_code < 400
        and not request.url.path.startswith("/api/v1/health")
    ):
        try:
            from app.core.security import decode_token
            from app.domain.models.audit import AuditEvent
            from app.infra.db.repositories import audit_repo

            auth = request.headers.get("authorization", "")
            user_id = "anonymous"
            if auth.lower().startswith("bearer "):
                try:
                    payload = decode_token(auth[7:])
                    user_id = payload.get("sub", "anonymous")
                except Exception:
                    pass

            action = f"{request.method.lower()}.{request.url.path.split('/')[-1] or 'root'}"
            ip = request.client.host if request.client else ""
            event = AuditEvent(
                user_id=user_id,
                action=action,
                resource=request.url.path,
                details={"method": request.method, "path": str(request.url.path)},
                ip=ip,
            )
            import asyncio as _asyncio

            _asyncio.create_task(audit_repo.log_event(event))
        except Exception:
            pass
    return response


app.include_router(api_v1_router, prefix="/api/v1")

# /metrics is scraped by Prometheus over the internal docker network directly
# (http://backend:8000/metrics) -- nginx never proxies it, so it isn't
# reachable from the internet-facing tunnel.
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


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

"""WebSocket endpoint — real-time price streaming for subscribed symbols."""

from __future__ import annotations

import asyncio
import json
from functools import partial

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core import connection_manager as cm
from app.core.security import decode_token

log = structlog.get_logger()

router = APIRouter(tags=["websocket"])

_STREAM_INTERVAL = 5  # seconds between price ticks


def _norm(sym: str) -> str:
    s = sym.upper().strip()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


async def _fetch_price(sym: str) -> dict:
    import yfinance as yf

    def _sync(s: str) -> dict:
        try:
            info = yf.Ticker(s).fast_info
            price = float(
                getattr(info, "last_price", None) or getattr(info, "previous_close", None) or 0
            )
            prev = float(getattr(info, "previous_close", None) or price)
            change = price - prev
            change_pct = (change / prev * 100) if prev else 0.0
            return {
                "symbol": s,
                "price": round(price, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 2),
                "ok": True,
            }
        except Exception as exc:
            return {"symbol": s, "price": None, "ok": False, "error": str(exc)}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_sync, sym))


@router.websocket("/ws/prices")
async def price_stream(websocket: WebSocket, token: str = ""):
    # Authenticate via query-param token
    user_id: str | None = None
    if token:
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
        except Exception:
            pass

    if not user_id:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    cm.register(user_id, websocket)
    log.info("ws.price_stream.connected", user_id=user_id)

    symbols: list[str] = []
    streaming = False
    stream_task: asyncio.Task | None = None

    async def _stream():
        while True:
            if not symbols:
                await asyncio.sleep(_STREAM_INTERVAL)
                continue
            ticks = await asyncio.gather(
                *[_fetch_price(s) for s in symbols], return_exceptions=True
            )
            payload = [t for t in ticks if isinstance(t, dict)]
            try:
                await websocket.send_json({"type": "tick", "data": payload})
            except Exception:
                break
            await asyncio.sleep(_STREAM_INTERVAL)

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=_STREAM_INTERVAL + 1)
            except TimeoutError:
                # No message — keep streaming
                if not streaming and symbols:
                    streaming = True
                    stream_task = asyncio.create_task(_stream())
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action", "")

            if action == "subscribe":
                raw_syms = msg.get("symbols", [])
                symbols = [_norm(s) for s in raw_syms if s][:20]  # max 20
                if stream_task and not stream_task.done():
                    stream_task.cancel()
                streaming = True
                stream_task = asyncio.create_task(_stream())
                await websocket.send_json({"type": "subscribed", "symbols": symbols})

            elif action == "unsubscribe":
                symbols = []
                if stream_task and not stream_task.done():
                    stream_task.cancel()
                streaming = False
                await websocket.send_json({"type": "unsubscribed"})

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        log.info("ws.price_stream.disconnected", user_id=user_id)
    finally:
        cm.deregister(user_id, websocket)
        if stream_task and not stream_task.done():
            stream_task.cancel()

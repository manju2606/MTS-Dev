"""Pine Alerts: receives TradingView's own alertcondition() firings (from
the Gold Guinea / Silver100 / NG Mini MTS Strategy Pine Scripts running on
TradingView's infrastructure) via a webhook, and exposes them for display on
each contract's dashboard -- the ground-truth record of what TradingView
itself fired, alongside (not instead of) this app's own independently
computed mcx_trade_signals.

POST /mcx/pine-alerts/webhook is hit directly by TradingView's alert
delivery (no user session, no custom headers possible), so it's secret-gated
via a ?token= query param -- same "publicly reachable, secret-gated instead
of JWT-authenticated" pattern chartink.py's /chartink/webhook uses, just
via query param since TradingView alerts (unlike Chartink's webhook config)
can't send an Authorization header.

Each alert's Message field is set to a fixed JSON template (see the alert
setup this receiver was built for):
  {"contract":"GOLDGUINEA","strategy":"MTS_GG_V1.1","type":"BUY","price":{{close}},"time":"{{time}}"}
so the body arrives as parseable JSON with TradingView's {{close}}/{{time}}
placeholders already substituted.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/mcx/pine-alerts", tags=["mcx"])

# Contracts this receiver accepts -- matches MTS Strategy Dashboard's three
# instruments (see mcx_strategy_dashboard_service.py).
_VALID_CONTRACTS = {"GOLDGUINEA", "SILVER100", "NGMINI"}
_VALID_SIGNAL_TYPES = {"BUY", "STRONG BUY", "SELL", "STRONG SELL", "HOLD"}


@router.post("/webhook")
async def pine_alerts_webhook(
    token: str = Query(default=""),
    body: dict = Body(...),
) -> dict:
    import structlog

    from app.core.config import settings
    from app.infra.db.repositories.pine_alert_repo import PineAlertRepository

    log = structlog.get_logger()

    if settings.PINE_ALERTS_WEBHOOK_SECRET:
        if token != settings.PINE_ALERTS_WEBHOOK_SECRET:
            raise HTTPException(
                status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook token"
            )
    else:
        log.warning(
            "pine_alerts.webhook.no_secret_configured",
            hint="Set PINE_ALERTS_WEBHOOK_SECRET to prevent unauthenticated callers "
            "from injecting fake alerts (this endpoint is proxied publicly along "
            "with the rest of /api/).",
        )

    contract = str(body.get("contract", "")).upper()
    strategy = str(body.get("strategy", ""))
    signal_type = str(body.get("type", "")).upper()
    price = body.get("price")
    tv_time = body.get("time")

    if contract not in _VALID_CONTRACTS:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown contract '{contract}', expected one of {sorted(_VALID_CONTRACTS)}",
        )
    if signal_type not in _VALID_SIGNAL_TYPES:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown type '{signal_type}', expected one of {sorted(_VALID_SIGNAL_TYPES)}",
        )

    try:
        price_f = float(price) if price is not None else None
    except (TypeError, ValueError):
        price_f = None

    repo = PineAlertRepository()
    await repo.create(
        contract=contract,
        strategy=strategy,
        signal_type=signal_type,
        price=price_f,
        message=str(body.get("message", "")),
        tv_time=str(tv_time) if tv_time else None,
        raw=body,
    )

    log.info("pine_alerts.webhook.received", contract=contract, type=signal_type)
    return {"received": True, "contract": contract, "type": signal_type}


@router.get("")
async def list_pine_alerts(current_user: CurrentUser, contract: str, limit: int = 50) -> list[dict]:
    from app.infra.db.repositories.pine_alert_repo import PineAlertRepository

    repo = PineAlertRepository()
    docs = await repo.list_recent(contract, limit)
    for d in docs:
        d["received_at"] = d["received_at"].isoformat()
    return docs

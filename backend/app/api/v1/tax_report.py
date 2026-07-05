"""Tax P&L report — Indian STCG / LTCG breakdown by financial year."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, TradeDep
from app.domain.models.trade import TradeMode, TradeStatus

router = APIRouter(prefix="/tax", tags=["tax-report"])

# ── helpers ──────────────────────────────────────────────────────────────────


def _fy_bounds(fy: str) -> tuple[datetime, datetime]:
    """Parse '2025-26' → (2025-04-01, 2026-03-31) as UTC datetimes."""
    try:
        start_year = int(fy.split("-")[0])
    except (ValueError, IndexError):
        raise HTTPException(status_code=422, detail="fy must be like '2025-26'")
    start = datetime(start_year, 4, 1, tzinfo=timezone.utc)
    end = datetime(start_year + 1, 3, 31, 23, 59, 59, tzinfo=timezone.utc)
    return start, end


def _holding_days(opened: datetime | None, closed: datetime | None) -> int:
    if not opened or not closed:
        return 0
    o = opened.replace(tzinfo=timezone.utc) if opened.tzinfo is None else opened
    c = closed.replace(tzinfo=timezone.utc) if closed.tzinfo is None else closed
    return (c - o).days


def _classify(days: int) -> str:
    return "LTCG" if days >= 365 else "STCG"


# ── endpoints ─────────────────────────────────────────────────────────────────


@router.get("/report")
async def tax_report(
    current_user: CurrentUser,
    trade_repo: TradeDep,
    fy: str = Query("2025-26", description="Financial year, e.g. 2025-26"),
    mode: str = Query("paper", description="paper | live | all"),
) -> dict:
    fy_start, fy_end = _fy_bounds(fy)
    all_trades = await trade_repo.list_by_user(current_user.id)

    trades = []
    for t in all_trades:
        if t.status != TradeStatus.CLOSED or t.closed_at is None or t.exit_price is None:
            continue
        if mode != "all" and t.mode.value != mode:
            continue
        closed_utc = t.closed_at.replace(tzinfo=timezone.utc) if t.closed_at.tzinfo is None else t.closed_at
        if not (fy_start <= closed_utc <= fy_end):
            continue
        trades.append(t)

    rows = []
    stcg_gain = stcg_loss = ltcg_gain = ltcg_loss = 0.0

    for t in trades:
        days = _holding_days(t.opened_at, t.closed_at)
        category = _classify(days)
        pnl = t.pnl or 0.0
        rows.append({
            "symbol": t.symbol,
            "signal": t.signal.value,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "quantity": t.quantity,
            "pnl": round(pnl, 2),
            "holding_days": days,
            "category": category,
            "opened_at": t.opened_at.isoformat() if t.opened_at else None,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "mode": t.mode.value,
        })
        if category == "STCG":
            if pnl >= 0:
                stcg_gain += pnl
            else:
                stcg_loss += pnl
        else:
            if pnl >= 0:
                ltcg_gain += pnl
            else:
                ltcg_loss += pnl

    stcg_net = round(stcg_gain + stcg_loss, 2)
    ltcg_net = round(ltcg_gain + ltcg_loss, 2)

    # Indian tax rates (FY2025-26 and beyond):
    # STCG on equity: 20% (Budget 2024 raised from 15%)
    # LTCG on equity: 12.5% on gains above ₹1,25,000 exemption
    stcg_tax = round(max(stcg_net, 0) * 0.20, 2)
    ltcg_exempt = 125_000.0
    ltcg_taxable = max(ltcg_net - ltcg_exempt, 0)
    ltcg_tax = round(ltcg_taxable * 0.125, 2)

    return {
        "fy": fy,
        "mode": mode,
        "total_trades": len(rows),
        "summary": {
            "stcg": {
                "gain": round(stcg_gain, 2),
                "loss": round(stcg_loss, 2),
                "net": stcg_net,
                "tax_rate_pct": 20.0,
                "estimated_tax": stcg_tax,
            },
            "ltcg": {
                "gain": round(ltcg_gain, 2),
                "loss": round(ltcg_loss, 2),
                "net": ltcg_net,
                "exemption": ltcg_exempt,
                "taxable": round(ltcg_taxable, 2),
                "tax_rate_pct": 12.5,
                "estimated_tax": ltcg_tax,
            },
            "total_pnl": round(stcg_net + ltcg_net, 2),
            "estimated_total_tax": round(stcg_tax + ltcg_tax, 2),
        },
        "trades": rows,
    }


@router.get("/export")
async def tax_export(
    current_user: CurrentUser,
    trade_repo: TradeDep,
    fy: str = Query("2025-26"),
    mode: str = Query("paper"),
) -> StreamingResponse:
    report = await tax_report(current_user, trade_repo, fy, mode)

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=["symbol", "signal", "entry_price", "exit_price", "quantity",
                    "pnl", "holding_days", "category", "opened_at", "closed_at", "mode"],
    )
    writer.writeheader()
    for row in report["trades"]:
        writer.writerow(row)

    buf.seek(0)
    filename = f"mts_tax_{fy}_{mode}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

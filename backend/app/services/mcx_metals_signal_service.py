"""AI trade-signal tracking for MCX metals -- sibling to
mcx_signal_service.py (Natural Gas). Only resolve_open_signals() calls a
commodity-specific quote fetch (get_metal_quote instead of get_quote);
everything else (logging, serialization, accuracy rollup) is pure
repo/dict logic and is imported and reused unchanged.
"""

from __future__ import annotations

from datetime import datetime

from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
from app.services.mcx_metals_service import get_metal_quote
from app.services.mcx_signal_service import (
    MCX_SIGNAL_EXPIRY_DAYS,
    check_and_log_signal,
)
from app.services.mcx_signal_service import (
    list_signals_with_accuracy as list_metal_signals_with_accuracy,
)

__all__ = [
    "check_and_log_signal",
    "list_metal_signals_with_accuracy",
    "resolve_open_metal_signals",
]


async def resolve_open_metal_signals(
    user_id: str, contract: str, repo: McxSignalRepository
) -> int:
    """Checks every OPEN signal for this (user, contract) against the live
    LTP -- closes it WIN/LOSS if target/stop-loss was hit, or EXPIRED if
    MCX_SIGNAL_EXPIRY_DAYS has passed with neither. Returns how many closed."""
    open_signals = await repo.list_open_signals(user_id, contract)
    if not open_signals:
        return 0

    quote = await get_metal_quote(user_id, contract)
    ltp = float(quote["last_price"])
    now = datetime.utcnow()
    closed = 0

    for sig in open_signals:
        direction = sig["direction"]
        entry = float(sig["entry_price"])
        stop_loss = float(sig["stop_loss"])
        target = float(sig["target_1"])

        result: str | None = None
        exit_price: float | None = None
        if direction == "BUY":
            if ltp >= target:
                result, exit_price = "WIN", target
            elif ltp <= stop_loss:
                result, exit_price = "LOSS", stop_loss
        else:
            if ltp <= target:
                result, exit_price = "WIN", target
            elif ltp >= stop_loss:
                result, exit_price = "LOSS", stop_loss

        age_days = (now - sig["generated_at"]).total_seconds() / 86400
        if result is None and age_days >= MCX_SIGNAL_EXPIRY_DAYS:
            result, exit_price = "EXPIRED", ltp

        if result is not None and exit_price is not None:
            pnl = round((exit_price - entry) * (1 if direction == "BUY" else -1), 2)
            await repo.close_signal(sig["_id"], result, exit_price, pnl, now, round(age_days, 2))
            closed += 1

    return closed

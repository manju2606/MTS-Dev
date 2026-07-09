"""AI trade-signal tracking: logs a signal whenever the NG-AI Pro score
hits verdict=TRADE, then watches it against the live price until target or
stop-loss is hit (WIN/LOSS) or MCX_SIGNAL_EXPIRY_DAYS passes with neither
(EXPIRED) -- see app/infra/db/repositories/mcx_signal_repo.py.

This is separate from actual paper trades (Trade domain model, placed only
when a user explicitly clicks "Use This Signal -> Trade"): a signal is
logged automatically for every strong AI call, whether or not anyone acted
on it, so accuracy can be tracked against the signal itself.
"""

from __future__ import annotations

from datetime import datetime

from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
from app.services.mcx_service import get_quote

MCX_SIGNAL_EXPIRY_DAYS = 5


async def check_and_log_signal(
    user_id: str, contract: str, direction: str, score: dict, repo: McxSignalRepository
) -> bool:
    """Logs a new OPEN signal if `score` is TRADE-tier and no signal for this
    (user, contract, direction) is already open. Returns True if logged."""
    if score["verdict"] != "TRADE":
        return False
    existing = await repo.get_open_signal(user_id, contract, direction)
    if existing is not None:
        return False

    entry = score["entry"]
    await repo.create_signal(
        user_id,
        contract,
        direction,
        {
            "tradingsymbol": score["tradingsymbol"],
            "score_pct": score["score_pct"],
            "entry_price": entry["entry_price"],
            "stop_loss": entry["stop_loss"],
            "target_1": entry["target_1"],
            "target_2": entry["target_2"],
            "generated_at": datetime.utcnow(),
        },
    )
    return True


async def resolve_open_signals(user_id: str, contract: str, repo: McxSignalRepository) -> int:
    """Checks every OPEN signal for this (user, contract) against the live
    LTP -- closes it WIN/LOSS if target/stop-loss was hit, or EXPIRED if
    MCX_SIGNAL_EXPIRY_DAYS has passed with neither. Returns how many closed."""
    open_signals = await repo.list_open_signals(user_id, contract)
    if not open_signals:
        return 0

    quote = await get_quote(user_id, contract)
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


def _serialize_signal(doc: dict) -> dict:
    return {
        "direction": doc["direction"],
        "tradingsymbol": doc.get("tradingsymbol"),
        "score_pct": doc.get("score_pct"),
        "generated_at": doc["generated_at"].isoformat(),
        "entry_price": doc["entry_price"],
        "stop_loss": doc["stop_loss"],
        "target_1": doc["target_1"],
        "target_2": doc.get("target_2"),
        "status": doc["status"],
        "result": doc.get("result"),
        "exit_price": doc.get("exit_price"),
        "pnl": doc.get("pnl"),
        "closed_at": doc["closed_at"].isoformat() if doc.get("closed_at") else None,
        "days_to_close": doc.get("days_to_close"),
    }


async def list_signals_with_accuracy(
    user_id: str, contract: str, limit: int, repo: McxSignalRepository
) -> dict:
    signals = await repo.list_signals(user_id, contract, limit)
    resolved = [s for s in signals if s.get("result") in ("WIN", "LOSS")]
    wins = sum(1 for s in resolved if s["result"] == "WIN")
    accuracy_pct = round(wins / len(resolved) * 100, 1) if resolved else None
    return {
        "contract": contract.upper(),
        "signals": [_serialize_signal(s) for s in signals],
        "accuracy": {"resolved": len(resolved), "wins": wins, "accuracy_pct": accuracy_pct},
    }

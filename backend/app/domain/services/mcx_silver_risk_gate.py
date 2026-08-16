"""MTS Silver Strategy risk gate -- unlike RiskEngine (risk_engine.py),
which validates one trade's own SL/target/quantity, this enforces the
strategy's *daily* controls (trade cap, consecutive-loss pause, daily loss
limit) plus session-window and expiry-protection checks, all as pure
functions over already-fetched data so they're independently testable
without a live broker session or database.

Every function here is a hard gate: if check_can_trade/is_within_session/
is_expiry_protected says no, the caller must not generate or log a new
signal -- same "Risk controls always override AI signals" rule CLAUDE.md
states for the rest of this app, just actually enforced here rather than
left as advisory text (see mcx_ai_score_service.py's risk_rules dict, which
is the status quo this module replaces for the Silver strategy specifically).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.domain.models.mcx_silver_risk_state import (
    SilverDailyState,
    SilverRiskCheckResult,
    SilverRiskConfig,
)


def compute_daily_state(closed_signals_today: list[dict]) -> SilverDailyState:
    """`closed_signals_today` must be sorted oldest-first (see
    McxSignalRepository.list_user_closed_signals_since, which already
    sorts this way) so the trailing consecutive-loss streak is read off
    the correct end of the list."""
    trade_count = len(closed_signals_today)
    realized_pnl = round(sum(float(s.get("pnl") or 0.0) for s in closed_signals_today), 2)

    consecutive_losses = 0
    for sig in reversed(closed_signals_today):
        if sig.get("result") == "LOSS":
            consecutive_losses += 1
        else:
            break

    return SilverDailyState(
        trade_count=trade_count,
        realized_pnl=realized_pnl,
        consecutive_losses=consecutive_losses,
    )


def check_can_trade(state: SilverDailyState, cfg: SilverRiskConfig) -> SilverRiskCheckResult:
    reasons: list[str] = []

    if state.trade_count >= cfg.max_trades_per_day:
        reasons.append(
            f"Max trades/day reached ({state.trade_count}/{cfg.max_trades_per_day})"
        )
    if state.consecutive_losses >= cfg.max_consecutive_losses:
        reasons.append(
            f"Paused after {state.consecutive_losses} consecutive losses "
            f"(max {cfg.max_consecutive_losses})"
        )
    max_loss_amount = cfg.capital * cfg.max_daily_loss_pct / 100
    if state.realized_pnl <= -max_loss_amount:
        reasons.append(
            f"Daily loss limit hit (₹{state.realized_pnl:,.2f} vs "
            f"-₹{max_loss_amount:,.2f} limit)"
        )

    return SilverRiskCheckResult(can_trade=not reasons, reasons=reasons)


def is_within_session(now: datetime, cfg: SilverRiskConfig) -> tuple[bool, str]:
    """`now` must already be in IST -- callers pass ist_now()'s result, this
    function does no timezone conversion of its own."""
    start_h, start_m = (int(x) for x in cfg.session_start.split(":"))
    end_h, end_m = (int(x) for x in cfg.session_end.split(":"))
    session_start = now.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
    session_end = now.replace(hour=end_h, minute=end_m, second=0, microsecond=0)

    if now < session_start or now > session_end:
        return False, f"outside MCX trading session ({cfg.session_start}-{cfg.session_end} IST)"

    buffered_start = session_start + timedelta(minutes=cfg.avoid_first_minutes)
    if now < buffered_start:
        return False, f"within first {cfg.avoid_first_minutes} minutes of session -- avoided"

    buffered_end = session_end - timedelta(minutes=cfg.avoid_last_minutes)
    if now > buffered_end:
        return False, f"within last {cfg.avoid_last_minutes} minutes of session -- avoided"

    return True, "within session"


def is_expiry_protected(
    expiry: date, now: datetime, cfg: SilverRiskConfig
) -> tuple[bool, str]:
    """True means "do not open new trades" -- inside the configured
    days-before-expiry window."""
    days_left = (expiry - now.date()).days
    if days_left <= cfg.days_before_expiry_stop:
        return True, (
            f"{days_left} day(s) to expiry ({expiry.isoformat()}) -- inside the "
            f"{cfg.days_before_expiry_stop}-day expiry protection window"
        )
    return False, f"{days_left} day(s) to expiry ({expiry.isoformat()})"

"""Short-horizon MCX metals price forecast -- sibling to
mcx_prediction_service.py (Natural Gas), same local EMA-slope/ROC-momentum/
ATR-cone heuristic (see that module's docstring for the full "why not
TimesFM" rationale, which applies unchanged here).

Only the handful of functions that call mcx_service.get_history()/get_quote()
directly are reimplemented against their metals equivalents
(mcx_metals_service.get_metal_history()/get_metal_quote()); every pure-math
helper (bucket/calendar arithmetic, resampling, serialization) and
get_archived_day() (pure Mongo query, no NG coupling at all) are imported
and reused unchanged from mcx_prediction_service.py.
"""

from __future__ import annotations

import time as _time
from datetime import datetime
from zoneinfo import ZoneInfo

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.services.mcx_metals_service import get_metal_history, get_metal_quote
from app.services.mcx_prediction_service import (
    ACCURACY_RECALIBRATE_BELOW_PCT,
    CALENDAR_HORIZON,
    CALENDAR_PERIODS,
    INTRADAY_PERIODS,
    MAX_HORIZON,
    MIN_CANDLES,
    MIN_CANDLES_CALENDAR,
    MIN_RECALIBRATION_SAMPLE,
    PERIOD_BUCKET_SECONDS,
    REFERENCE_PERIOD,
    _buckets_until_market_close,
    _calendar_key,
    _calendar_key_start_epoch,
    _next_calendar_key,
    _resample_calendar,
    _serialize_history,
    _slope_momentum_atr,
    _snap_to_session_grid,
    _sync_recalibrate_other_periods,
)
from app.services.mcx_prediction_service import (
    get_archived_day as get_metal_archived_day,  # pure Mongo query, no NG coupling
)

_IST = ZoneInfo("Asia/Kolkata")
_SESSION_OPEN_HOUR = 9
_SESSION_OPEN_MINUTE = 0

__all__ = ["get_metal_prediction", "get_metal_archived_day"]


async def _session_open_reference(user_id: str, contract: str) -> dict:
    quote = await get_metal_quote(user_id, contract)
    from app.services.mcx_service import ist_now

    today = ist_now().replace(
        hour=_SESSION_OPEN_HOUR, minute=_SESSION_OPEN_MINUTE, second=0, microsecond=0
    )
    return {"time": int(today.timestamp()), "price": float(quote["open"])}


async def _reference_rate(
    user_id: str, contract: str, period: str, candles: list[dict]
) -> tuple[float, float]:
    if period == REFERENCE_PERIOD:
        ref_candles = candles
    else:
        ref_candles = await get_metal_history(user_id, REFERENCE_PERIOD, contract)
    if len(ref_candles) < MIN_CANDLES:
        return 0.0, 0.0
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(ref_candles)
    ref_bucket = PERIOD_BUCKET_SECONDS[REFERENCE_PERIOD]
    slope_per_second = (slope / ref_bucket) * conviction
    atr_per_sqrt_second = atr_val / (ref_bucket**0.5)
    return slope_per_second, atr_per_sqrt_second


async def _live_anchor(
    user_id: str, contract: str, fallback_price: float, fallback_time: int
) -> tuple[float, int]:
    try:
        quote = await get_metal_quote(user_id, contract)
        return float(quote["last_price"]), int(_time.time())
    except Exception:
        return fallback_price, fallback_time


async def get_metal_prediction(
    user_id: str, contract: str, period: str, repo: McxPredictionRepository
) -> dict:
    is_calendar = period in CALENDAR_PERIODS
    if is_calendar:
        raw_candles = await get_metal_history(user_id, "1Y", contract)
        candles = _resample_calendar(raw_candles, period)
    else:
        candles = await get_metal_history(user_id, period, contract)
    bucket = None if is_calendar else PERIOD_BUCKET_SECONDS.get(period, 86400)
    min_candles = MIN_CANDLES_CALENDAR if is_calendar else MIN_CANDLES

    await repo.resolve_pending(user_id, contract, period, candles)

    recal_state = None if is_calendar else await repo.get_recalibration_state(
        user_id, contract, period
    )
    since = recal_state["last_recalibrated_at"] if recal_state else None
    accuracy = await repo.get_accuracy_stats(user_id, contract, period, since=since)
    if recal_state:
        accuracy["recalibrated_at"] = recal_state["last_recalibrated_at"].isoformat()
        accuracy["recalibrated_from_pct"] = recal_state.get("from_accuracy_pct")
        accuracy["recalibrated_deviation_pct"] = recal_state.get("deviation_pct")

    session_open_reference = None
    if not is_calendar:
        try:
            session_open_reference = await _session_open_reference(user_id, contract)
        except Exception:
            session_open_reference = None

    if len(candles) < min_candles:
        note = f"Need at least {min_candles} candles for a forecast (have {len(candles)})."
        if is_calendar:
            note += (
                " MCX metals contracts are monthly-expiring futures, so the current"
                " front-month instrument only has a few months of its own history."
            )
        return {
            "contract": contract.upper(),
            "period": period,
            "predicted": [],
            "history": _serialize_history(await repo.get_recent(user_id, contract, period)),
            "accuracy": accuracy,
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
            "note": note,
            "session_open_reference": session_open_reference,
        }

    last_time = int(candles[-1]["time"])
    last_close = float(candles[-1]["close"])

    predicted = []
    if is_calendar:
        slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)
        key = _calendar_key(last_time, period)
        for i in range(1, CALENDAR_HORIZON + 1):
            key = _next_calendar_key(key, period)
            proj_close = last_close + slope * i * conviction
            band = atr_val * (i**0.5)
            predicted.append(
                {
                    "time": _calendar_key_start_epoch(key, period),
                    "predicted_close": round(proj_close, 2),
                    "upper": round(proj_close + band, 2),
                    "lower": round(proj_close - band, 2),
                }
            )
    else:
        slope_per_second, atr_per_sqrt_second = await _reference_rate(
            user_id, contract, period, candles
        )
        anchor_price, anchor_time = await _live_anchor(user_id, contract, last_close, last_time)
        grid_anchor = _snap_to_session_grid(last_time, bucket)  # type: ignore[arg-type]
        horizon = _buckets_until_market_close(grid_anchor, bucket)  # type: ignore[arg-type]
        for i in range(1, horizon + 1):
            t = grid_anchor + i * bucket  # type: ignore[operator]
            seconds_ahead = t - anchor_time
            proj_close = anchor_price + slope_per_second * seconds_ahead
            band = atr_per_sqrt_second * (max(seconds_ahead, 0) ** 0.5)
            predicted.append(
                {
                    "time": t,
                    "predicted_close": round(proj_close, 2),
                    "upper": round(proj_close + band, 2),
                    "lower": round(proj_close - band, 2),
                }
            )

    if not is_calendar:
        avg_error = accuracy.get("avg_error_pct")
        sample_size = accuracy.get("sample_size", 0)
        if (
            avg_error is not None
            and sample_size >= MIN_RECALIBRATION_SAMPLE
            and (100 - avg_error) < ACCURACY_RECALIBRATE_BELOW_PCT
        ):
            await repo.refresh_pending(user_id, contract, period, predicted)
            now = datetime.utcnow()
            prev_acc_pct = round(100 - avg_error, 2)
            deviation_pct = round(avg_error, 3)
            await repo.set_recalibration_state(
                user_id,
                contract,
                period,
                now,
                reason=f"accuracy {prev_acc_pct}% dropped below {ACCURACY_RECALIBRATE_BELOW_PCT}%",
                from_accuracy_pct=prev_acc_pct,
                deviation_pct=deviation_pct,
            )
            accuracy = {
                **accuracy,
                "recalibrated": True,
                "recalibrated_at": now.isoformat(),
                "recalibrated_from_pct": prev_acc_pct,
                "recalibrated_deviation_pct": deviation_pct,
            }
            if period in INTRADAY_PERIODS:
                await _sync_recalibrate_other_periods(
                    user_id,
                    contract,
                    repo,
                    period,
                    anchor_price,
                    anchor_time,
                    slope_per_second,
                    atr_per_sqrt_second,
                )

    await repo.save_predictions(user_id, contract, period, predicted)
    history = _serialize_history(
        await repo.get_recent(user_id, contract, period, limit=MAX_HORIZON + 100)
    )

    return {
        "contract": contract.upper(),
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": round(last_close, 2),
        "predicted": predicted,
        "history": history,
        "accuracy": accuracy,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
        "session_open_reference": session_open_reference,
    }

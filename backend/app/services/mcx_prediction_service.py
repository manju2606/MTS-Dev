"""Short-horizon MCX price forecast: a lightweight local extrapolator (EMA
slope + ROC momentum + an ATR-based uncertainty cone), not literally Google
TimesFM. TimesFM needs Python <=3.11 with PyTorch/JAX and a ~200-500MB model
checkpoint -- this backend runs Python 3.14 with no GPU in the Docker setup,
so real TimesFM inference would need a separate service and would be slow
(seconds, not ms) per call. This gives the same functional shape instead --
a predicted path in a distinct colour per chart timeframe, plus a tracked
hit-rate -- using data already computed for the AI score (ng_indicators.py).

Not a real forecasting model: it's a straight-line projection of the recent
EMA20 slope, damped or reinforced by whether momentum (ROC) agrees with that
slope, with a widening ATR-based band standing in for uncertainty. Treat the
predicted path as a visual aid, not a trading signal on its own.
"""

from __future__ import annotations

import time as _time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.infra.mcx import ng_indicators as ind
from app.services.mcx_service import get_history, get_quote, ist_now

_IST = ZoneInfo("Asia/Kolkata")
_SESSION_OPEN_HOUR = 9
_SESSION_OPEN_MINUTE = 0

# Real candle-bucket width in seconds per period -- mirrors
# mcx_service._HISTORY_PERIOD_MAP's actual Kite interval choice (e.g. "30m"
# is built from 15-minute candles, not 30-minute ones).
PERIOD_BUCKET_SECONDS: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    # "30m" genuinely means a 30-minute prediction bucket (1800s) -- NOT the
    # 15-minute Kite candle interval mcx_service._HISTORY_PERIOD_MAP uses to
    # fetch the underlying candles for this period (that choice is about
    # chart rendering density, unrelated to what "30 Mins" should predict
    # in). Using the candle interval here instead produced buckets on a
    # 15-minute-offset grid (9:45, 10:15, 10:45...) rather than a clean
    # 30-minute one from session open (9:00, 9:30, 10:00...).
    "30m": 1800,
    "45m": 3600,
    "1h": 3600,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "1D": 86400,
    "5D": 86400,
    "1W": 86400,
    "1M": 86400,
    "3M": 86400,
    "6M": 86400,
    "1Y": 86400,
}

# All intraday periods (1m/5m/15m/30m/45m/1h/4h/6h/8h) share ONE trend/volatility
# read, calibrated from this reference timeframe, instead of each computing
# its own independent EMA slope from its own candles. Without this, the
# Minutes/15-Mins/1-Hr columns could -- and did -- predict wildly different
# prices for the *same* real timestamp (e.g. 11:00 PM), since a 1-minute
# EMA20 slope reflects different noise than a 1-hour one. Deliberately NOT
# applied to 1Wk/1Mo -- forcing a 15-minute-derived rate onto a week/month
# horizon would extrapolate short-term noise absurdly far; those keep their
# own appropriately-scaled slope.
REFERENCE_PERIOD = "15m"

# The periods that actually get requested/displayed and share the
# REFERENCE_PERIOD machinery above -- used to fan a recalibration event out
# to every OTHER period sharing one anchor snapshot (see
# _sync_recalibrate_other_periods) so their pending buckets never drift
# apart from independently recalibrating at different moments.
INTRADAY_PERIODS = ("1m", "5m", "15m", "30m", "1h", "4h", "6h", "8h")

# "1Wk"/"1Mo" are calendar-bucketed (ISO week / calendar month), not fixed-
# second buckets like everything else -- Kite has no native weekly/monthly
# candle interval, so these are resampled here from daily candles, the same
# way mcx_trend_service.py resamples for its own "1W" trend timeframe.
CALENDAR_PERIODS = ("1Wk", "1Mo")
CALENDAR_HORIZON = 8  # weeks/months ahead to prefill -- "end of day" doesn't
# apply at this granularity, so this is just a sensible fixed lookahead.

# MCX's commodity session runs well past NSE hours -- there's no dedicated
# hours module for it in this codebase (NSE/BSE has one, app/infra/market/
# hours.py, 09:15-15:30 IST), only this same approximation already used by
# the scheduler's MCX cron jobs (app/core/scheduler.py). No holiday-calendar
# handling here either, matching that existing approximation.
MARKET_CLOSE_HOUR = 23
MARKET_CLOSE_MINUTE = 45

MIN_CANDLES = 25
# MCX Natural Gas trades as a monthly-expiring futures contract -- the
# current front-month instrument didn't exist a year ago (it's only listed
# a few months before its own expiry), so there is no 5-year continuous
# history to resample, unlike a stock or index. A real multi-year series
# would need splicing candles across every past contract's roll, which this
# app doesn't do. MIN_CANDLES's 25-bar bar is unreachable for "1Mo" as a
# result (~7 months of real front-month history at most) -- this lower
# threshold accepts a rougher read from whatever's actually available
# rather than never showing a week/month prediction at all.
MIN_CANDLES_CALENDAR = 6
# Cap on how many future buckets to prefill toward market close -- 900
# covers a full trading day (09:00-23:45 IST = 885 minutes) even for the
# "Minutes" (1m) column, the finest granularity. Mongo writes are cheap
# (idempotent $setOnInsert upserts -- a later call in the same day only
# inserts the buckets that don't already exist), so the cost here is mostly
# how many rows the frontend ends up carrying, not backend load.
MAX_HORIZON = 900

# Recalibration: a straight-line extrapolation drifts further from reality
# the longer a still-pending prediction sits unrefreshed (a bucket prefilled
# at 09:05 for 11 PM keeps that 09:05 anchor for 14+ hours otherwise -- see
# save_predictions' $setOnInsert, which only ever inserts a bucket once).
# When the rolling accuracy for a period's *own* resolved predictions drops
# below this, every still-pending (unresolved) bucket for that period gets
# recomputed from the current live anchor/rate -- a real re-forecast, not a
# display trick. Resolved predictions are never touched or hidden; the
# accuracy stat's own sample window resets to "since this recalibration" so
# it visibly reflects the improvement, while the full history stays intact
# in the trail. Intraday periods only -- see REFERENCE_PERIOD's note on why
# 1Wk/1Mo are deliberately excluded from shared short-horizon machinery.
#
# 99.5%/3 (rather than 99.0%/5) trips sooner and off a smaller sample --
# pending buckets get refreshed before they've drifted as far, at the cost
# of reacting to noisier, less-certain accuracy reads. This raises the
# realistic ceiling on the per-row accuracy number; it cannot force it to
# literally 100% -- see this module's own docstring for why that's not
# attempted.
ACCURACY_RECALIBRATE_BELOW_PCT = 99.5
MIN_RECALIBRATION_SAMPLE = 3


def _snap_to_session_grid(t: int, bucket: int) -> int:
    """Snap epoch `t` down to the nearest `bucket`-second grid line anchored
    to that day's MCX session open (09:00 IST). Needed because the anchor
    (the last real candle) can sit on a finer grid than the prediction
    bucket itself -- e.g. "30m" predictions are generated from 15-minute
    Kite candles (see PERIOD_BUCKET_SECONDS's comment), so an anchor at 9:15
    would otherwise generate 9:45, 10:15, 10:45... instead of the clean
    9:00, 9:30, 10:00... grid. A no-op for periods whose candle interval
    already matches the bucket size."""
    dt = datetime.fromtimestamp(t, tz=_IST)
    session_open = dt.replace(
        hour=_SESSION_OPEN_HOUR, minute=_SESSION_OPEN_MINUTE, second=0, microsecond=0
    )
    elapsed = int((dt - session_open).total_seconds())
    if elapsed < 0:
        return int(session_open.timestamp())
    return int(session_open.timestamp()) + (elapsed // bucket) * bucket


def _buckets_until_market_close(last_time: int, bucket: int) -> int:
    """How many more `bucket`-second candles remain before MCX's own session
    close (not literal midnight) on the day `last_time` falls on -- i.e.
    "prefill predictions for the rest of the trading day, not past it",
    capped at MAX_HORIZON. Buckets past market close would never resolve
    anyway (no candle will ever exist there), so this both matches the
    market's actual hours and avoids generating dead, permanently-pending
    rows for the overnight gap."""
    last_dt = datetime.fromtimestamp(last_time, tz=_IST)
    market_close = last_dt.replace(
        hour=MARKET_CLOSE_HOUR, minute=MARKET_CLOSE_MINUTE, second=0, microsecond=0
    )
    remaining_seconds = int((market_close - last_dt).total_seconds())
    if remaining_seconds <= 0:
        return 0
    return min(remaining_seconds // bucket, MAX_HORIZON)


def _calendar_key(epoch: int, kind: str) -> tuple[int, int]:
    """(year, ISO-week) for "1Wk", (year, month) for "1Mo", from an epoch
    second interpreted in IST."""
    dt = datetime.fromtimestamp(epoch, tz=_IST)
    return dt.isocalendar()[:2] if kind == "1Wk" else (dt.year, dt.month)


def _calendar_key_start_epoch(key: tuple[int, int], kind: str) -> int:
    """Canonical bucket-start epoch (00:00 IST on the Monday / 1st) for a
    (year, week-or-month) key -- used for BOTH resampled real candles and
    generated future predictions, so resolve_pending's exact-time matching
    lines up between them."""
    d = date.fromisocalendar(key[0], key[1], 1) if kind == "1Wk" else date(key[0], key[1], 1)
    return int(datetime(d.year, d.month, d.day, tzinfo=_IST).timestamp())


def _next_calendar_key(key: tuple[int, int], kind: str) -> tuple[int, int]:
    if kind == "1Wk":
        d = date.fromisocalendar(key[0], key[1], 1) + timedelta(days=7)
        return d.isocalendar()[:2]
    year, month = key
    return (year, month + 1) if month < 12 else (year + 1, 1)


def _resample_calendar(daily_candles: list[dict], kind: str) -> list[dict]:
    """Roll up daily candles (mcx_service.get_history()'s {time, open, high,
    low, close, volume} shape) into ISO-week or calendar-month OHLC bars."""
    buckets: dict[tuple[int, int], list[dict]] = {}
    for c in daily_candles:
        buckets.setdefault(_calendar_key(c["time"], kind), []).append(c)
    out = []
    for key in sorted(buckets):
        bucket = buckets[key]
        out.append(
            {
                "time": _calendar_key_start_epoch(key, kind),
                "open": bucket[0]["open"],
                "high": max(b["high"] for b in bucket),
                "low": min(b["low"] for b in bucket),
                "close": bucket[-1]["close"],
                "volume": sum(b.get("volume", 0) for b in bucket),
            }
        )
    return out


async def _session_open_reference(user_id: str, contract: str) -> dict:
    """The real price at today's MCX session open (09:00 IST) -- shown as a
    distinct reference row (not a prediction) at the top of every intraday
    accuracy table, so each one visually starts at 09:00 even though its
    first genuinely predictable bucket is later (e.g. "Hours" can't predict
    the 9-10 hour itself, since that's real/current data, not a forecast)."""
    quote = await get_quote(user_id, contract)
    today = ist_now().replace(
        hour=_SESSION_OPEN_HOUR, minute=_SESSION_OPEN_MINUTE, second=0, microsecond=0
    )
    return {"time": int(today.timestamp()), "price": float(quote["open"])}


def _slope_momentum_atr(candles: list[dict]) -> tuple[float, float, float, float]:
    """(slope-per-bucket, momentum, atr, conviction) from one candle set --
    shared by the reference-rate calc and the calendar (week/month) branch."""
    c = ind.closes(candles)
    h = ind.highs(candles)
    low = ind.lows(candles)
    ema20 = ind.ema_series(c, 20)
    slope = (ema20[-1] - ema20[-5]) / 5 if len(ema20) >= 5 else 0.0
    momentum = ind.roc(c, 10) or 0.0
    atr_val = ind.atr(h, low, c, 14) or (c[-1] * 0.005)
    momentum_sign = 1 if momentum > 0 else (-1 if momentum < 0 else 0)
    slope_sign = 1 if slope > 0 else (-1 if slope < 0 else 0)
    conviction = 1.15 if (slope_sign != 0 and momentum_sign == slope_sign) else 0.65
    return slope, momentum, atr_val, conviction


async def _reference_rate(
    user_id: str, contract: str, period: str, candles: list[dict]
) -> tuple[float, float]:
    """Continuous-time (per-second) drift + volatility, calibrated ONCE from
    REFERENCE_PERIOD candles regardless of which intraday period was
    requested -- reuses `candles` directly if the caller already fetched
    exactly REFERENCE_PERIOD, otherwise fetches it separately. This is what
    makes the predicted price for a given real timestamp identical across
    the Minutes/15-Mins/30-Mins/Hours columns instead of each one computing
    its own independent (and divergent) slope."""
    if period == REFERENCE_PERIOD:
        ref_candles = candles
    else:
        ref_candles = await get_history(user_id, REFERENCE_PERIOD, contract)
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
    """The live quote's LTP + current wall-clock time as the (price, time)
    origin every intraday prediction is projected from -- falls back to the
    last candle's own close/time if the live quote call fails for any
    reason, so a broker hiccup degrades gracefully instead of erroring."""
    try:
        quote = await get_quote(user_id, contract)
        return float(quote["last_price"]), int(_time.time())
    except Exception:
        return fallback_price, fallback_time


async def _sync_recalibrate_other_periods(
    user_id: str,
    contract: str,
    repo: McxPredictionRepository,
    triggered_period: str,
    anchor_price: float,
    anchor_time: int,
    slope_per_second: float,
    atr_per_sqrt_second: float,
) -> None:
    """When one intraday period's own accuracy trips the recalibration
    threshold, refresh every OTHER intraday period's pending buckets from
    that SAME anchor/rate snapshot right now, instead of letting each one
    recalibrate independently whenever its own threshold happens to trip
    later. Without this, two periods refreshed minutes apart each pull a
    fresh live quote -- and since price genuinely moves between those calls,
    their forecasts for the same future timestamp diverge. That's exactly
    the "wildly different price for the same real timestamp" problem
    REFERENCE_PERIOD/_live_anchor exist to prevent (see their docstrings);
    independent per-period recalibration just reopens it for pending
    buckets. Grid/horizon use `anchor_time` (not each period's own last
    candle) as the reference point -- _snap_to_session_grid only depends on
    time-of-day, so this still lands on the correct bucket grid."""
    now = datetime.utcnow()
    for period in INTRADAY_PERIODS:
        if period == triggered_period:
            continue
        bucket = PERIOD_BUCKET_SECONDS[period]
        grid_anchor = _snap_to_session_grid(anchor_time, bucket)
        horizon = _buckets_until_market_close(grid_anchor, bucket)
        predicted = []
        for i in range(1, horizon + 1):
            t = grid_anchor + i * bucket
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
        updated = await repo.refresh_pending(user_id, contract, period, predicted)
        if not updated:
            continue
        prior = await repo.get_recalibration_state(user_id, contract, period)
        since = prior["last_recalibrated_at"] if prior else None
        stats = await repo.get_accuracy_stats(user_id, contract, period, since=since)
        prev_avg_error = stats.get("avg_error_pct")
        prev_acc_pct = round(100 - prev_avg_error, 2) if prev_avg_error is not None else None
        await repo.set_recalibration_state(
            user_id,
            contract,
            period,
            now,
            reason=f"synced from {triggered_period} recalibration",
            from_accuracy_pct=prev_acc_pct,
            deviation_pct=prev_avg_error,
        )


async def get_prediction(
    user_id: str, contract: str, period: str, repo: McxPredictionRepository
) -> dict:
    is_calendar = period in CALENDAR_PERIODS
    if is_calendar:
        # "1Y" requests the longest lookback mcx_service._HISTORY_PERIOD_MAP
        # offers (nominally 5 years) -- in practice capped by how long the
        # current front-month contract has existed (see MIN_CANDLES_CALENDAR).
        # Passing "1Wk"/"1Mo" straight through would silently fall back to
        # that map's unmatched-key default of just 1 year instead.
        raw_candles = await get_history(user_id, "1Y", contract)
        candles = _resample_calendar(raw_candles, period)
    else:
        candles = await get_history(user_id, period, contract)
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
                " MCX Natural Gas is a monthly-expiring futures contract, so the current"
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
    # limit covers a day's worth of resolved+pending buckets for the finer
    # periods plus some back-history -- MAX_HORIZON (forward) + 100 (back).
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


def _serialize_history(docs: list[dict]) -> list[dict]:
    """Trim stored Mongo prediction docs down to what the chart/table need --
    the full trail (resolved and still-pending) so past predictions keep
    showing on the chart instead of disappearing once superseded."""
    return [
        {
            "time": d["predicted_time"],
            "predicted_close": d["predicted_close"],
            "upper": d["upper"],
            "lower": d["lower"],
            "actual_close": d.get("actual_close"),
            "hit": d.get("hit"),
        }
        for d in docs
    ]


GLOBAL_PREDICTION_HORIZON_DAYS = 10
MIN_CANDLES_GLOBAL = 25
# Henry Hub (and any future global-symbol) predictions are stored under this
# fixed pseudo-user -- unlike MCX contracts, this data isn't tied to any
# user's own Kite session (it's the same public yfinance series for
# everyone), so sharing one prediction/accuracy trail across all users avoids
# redundant duplicate computation and gives the accuracy stat a larger
# sample faster than partitioning it per-user would.
GLOBAL_PREDICTION_USER = "global"


async def get_global_prediction(
    candles: list[dict], repo: McxPredictionRepository, key: str = "NG_GLOBAL"
) -> dict:
    """Daily-only short-horizon forecast for a non-MCX candle series (e.g.
    yfinance Henry Hub) -- the same EMA-slope + ROC-momentum + ATR-cone
    heuristic as get_prediction, but without that function's MCX-specific
    machinery: no Kite live-quote anchor (global data updates once a day, not
    tick-by-tick), no intraday session-grid bucketing, no cross-period
    recalibration sync (there's only ever one period here, "1D"). `key`
    namespaces the prediction/accuracy trail in Mongo (reuses the same
    McxPredictionRepository -- it's keyed on (user_id, contract, period) as
    plain strings, so a distinct `key` here can't collide with any real MCX
    contract's own predictions).
    """
    period = "1D"
    await repo.resolve_pending(GLOBAL_PREDICTION_USER, key, period, candles)
    accuracy = await repo.get_accuracy_stats(GLOBAL_PREDICTION_USER, key, period)

    if len(candles) < MIN_CANDLES_GLOBAL:
        return {
            "contract": key,
            "period": period,
            "predicted": [],
            "history": _serialize_history(
                await repo.get_recent(GLOBAL_PREDICTION_USER, key, period)
            ),
            "accuracy": accuracy,
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
            "note": (
                f"Need at least {MIN_CANDLES_GLOBAL} daily candles for a forecast "
                f"(have {len(candles)})."
            ),
        }

    last_time = int(candles[-1]["time"])
    last_close = float(candles[-1]["close"])
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)

    predicted = []
    day_seconds = 86400
    for i in range(1, GLOBAL_PREDICTION_HORIZON_DAYS + 1):
        proj_close = last_close + slope * i * conviction
        band = atr_val * (i**0.5)
        predicted.append(
            {
                "time": last_time + i * day_seconds,
                "predicted_close": round(proj_close, 2),
                "upper": round(proj_close + band, 2),
                "lower": round(proj_close - band, 2),
            }
        )

    await repo.save_predictions(GLOBAL_PREDICTION_USER, key, period, predicted)
    history = _serialize_history(
        await repo.get_recent(GLOBAL_PREDICTION_USER, key, period, limit=200)
    )

    return {
        "contract": key,
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": round(last_close, 2),
        "predicted": predicted,
        "history": history,
        "accuracy": accuracy,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
    }


async def get_archived_day(
    user_id: str, contract: str, period: str, date_str: str, repo: McxPredictionRepository
) -> dict:
    """Every prediction made for a specific past IST calendar date
    ("YYYY-MM-DD") -- the archive view behind each collapsed day in the
    accuracy table. No separate snapshot job: predictions are permanently
    kept in Mongo, so this just queries that same collection by date range."""
    day = date.fromisoformat(date_str)
    start_epoch = int(datetime(day.year, day.month, day.day, tzinfo=_IST).timestamp())
    end_epoch = start_epoch + 86400 - 1

    docs = await repo.get_by_date_range(user_id, contract, period, start_epoch, end_epoch)
    return {
        "contract": contract.upper(),
        "period": period,
        "date": date_str,
        "history": _serialize_history(docs),
    }

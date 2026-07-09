"""Market-sentiment forecasting: a transparent, rule-based weekly projection
of NSE market breadth, tracked against what actually happens each day.

Forecast formula (deliberately simple and auditable, not a black-box model):

    forecast_bull_pct = clamp(avg_bull_pct_3d + vix_adjustment + nifty_adjustment, 0, 100)

    avg_bull_pct_3d   = trailing 3-trading-day average of actual bull %
                        (falls back to 50.0 -- neutral -- with < 3 days of history)
    vix_adjustment    = clamp((15 - vix_level) * 1.5, -8, 8)
                        lower India VIX (less fear) tilts the forecast bullish
    nifty_adjustment  = clamp(nifty_5d_return_pct * 2, -8, 8)
                        positive recent Nifty momentum tilts the forecast bullish

The same forecast_bull_pct/label is applied to every weekday (Mon-Fri) when
generated on Monday morning -- a genuine "week ahead" call, not five separate
guesses.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from functools import partial

import structlog

from app.domain.models.sentiment_forecast import (
    ForecastDay,
    SentimentSnapshot,
    WeeklySentimentForecast,
)
from app.infra.db.repositories.discovery_repo import DiscoveryRepository
from app.infra.db.repositories.sentiment_forecast_repo import SentimentForecastRepository

log = structlog.get_logger()

_WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def _classify(bull_pct: float, bear_pct: float) -> str:
    if bull_pct >= 55:
        return "Bullish"
    if bull_pct >= 45:
        return "Cautiously Bullish"
    if bear_pct >= 55:
        return "Bearish"
    if bear_pct >= 40:
        return "Cautious"
    return "Neutral"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _fetch_vix_and_nifty_sync() -> dict:
    """India VIX level + Nifty 5-day momentum, via yfinance (best-effort)."""
    import yfinance as yf

    result: dict = {
        "vix_value": None,
        "vix_change_pct": None,
        "nifty_close": None,
        "nifty_momentum_pct": None,
    }
    try:
        vix_hist = yf.Ticker("^INDIAVIX").history(period="2d", interval="1d")
        if len(vix_hist) >= 1:
            result["vix_value"] = round(float(vix_hist["Close"].iloc[-1]), 2)
        if len(vix_hist) >= 2:
            prev = float(vix_hist["Close"].iloc[-2])
            cur = float(vix_hist["Close"].iloc[-1])
            result["vix_change_pct"] = round((cur - prev) / prev * 100, 2) if prev else 0.0
    except Exception as exc:
        log.warning("sentiment_forecast.vix_fetch.failed", error=str(exc))

    try:
        nifty_hist = yf.Ticker("^NSEI").history(period="6d", interval="1d")
        if len(nifty_hist) >= 1:
            result["nifty_close"] = round(float(nifty_hist["Close"].iloc[-1]), 2)
        if len(nifty_hist) >= 2:
            first = float(nifty_hist["Close"].iloc[0])
            last = float(nifty_hist["Close"].iloc[-1])
            result["nifty_momentum_pct"] = round((last - first) / first * 100, 2) if first else 0.0
    except Exception as exc:
        log.warning("sentiment_forecast.nifty_fetch.failed", error=str(exc))

    return result


async def compute_daily_snapshot() -> SentimentSnapshot:
    """Compute and persist today's actual market sentiment from the latest
    Discovery scan, mirroring the dashboard's live SentimentCard math.
    """
    discovery_repo = DiscoveryRepository()
    picks = await discovery_repo.get_top_picks(limit=1000)

    bullish = sum(1 for p in picks if p.signal in ("STRONG_BUY", "BUY"))
    bearish = sum(1 for p in picks if p.signal in ("STRONG_SELL", "SELL"))
    watch = sum(1 for p in picks if p.signal == "WATCH")
    total = len(picks)

    bull_pct = round(bullish / total * 100, 2) if total else 0.0
    bear_pct = round(bearish / total * 100, 2) if total else 0.0
    label = _classify(bull_pct, bear_pct)

    loop = asyncio.get_running_loop()
    market = await loop.run_in_executor(None, partial(_fetch_vix_and_nifty_sync))

    snapshot = SentimentSnapshot(
        date=date.today().isoformat(),
        bullish_count=bullish,
        bearish_count=bearish,
        watch_count=watch,
        total_count=total,
        bull_pct=bull_pct,
        bear_pct=bear_pct,
        label=label,
        vix=market["vix_value"],
        nifty_close=market["nifty_close"],
    )

    repo = SentimentForecastRepository()
    await repo.save_snapshot(snapshot)

    # If this week already has a forecast, fill in today's actual outcome.
    week_start = _week_start(date.today()).isoformat()
    await repo.resolve_forecast_day(week_start, snapshot.date, bull_pct, label)

    return snapshot


async def generate_weekly_forecast(today: date | None = None) -> WeeklySentimentForecast:
    """Generate (or regenerate) this week's Mon-Fri sentiment forecast."""
    today = today or date.today()
    week_start_date = _week_start(today)
    week_start = week_start_date.isoformat()

    repo = SentimentForecastRepository()
    recent = await repo.get_recent_snapshots(limit=3)
    avg_bull_pct_3d = (
        round(sum(s["bull_pct"] for s in recent) / len(recent), 2) if recent else 50.0
    )
    # Track bear_pct the same way as bull_pct (a trailing actual average), not as
    # `100 - bull_pct`. Actual daily bear_pct only counts STRONG_SELL/SELL signals
    # out of the *whole* universe -- with WATCH/NEUTRAL/BUY-side signals also in the
    # mix, real bear_pct typically sits well under 20%, nowhere near a 100-bull_pct
    # complement. Treating it as a complement pushed the proxy past the "Bearish"
    # classification threshold almost every day regardless of actual conditions.
    avg_bear_pct_3d = (
        round(sum(s["bear_pct"] for s in recent) / len(recent), 2) if recent else 20.0
    )

    loop = asyncio.get_running_loop()
    market = await loop.run_in_executor(None, partial(_fetch_vix_and_nifty_sync))
    vix_value = market["vix_value"]
    nifty_momentum_pct = market["nifty_momentum_pct"] or 0.0

    vix_adjustment = _clamp((15 - vix_value) * 1.5, -8, 8) if vix_value is not None else 0.0
    nifty_adjustment = _clamp(nifty_momentum_pct * 2, -8, 8)

    raw_bull_forecast = avg_bull_pct_3d + vix_adjustment + nifty_adjustment
    forecast_bull_pct = round(_clamp(raw_bull_forecast, 0, 100), 2)
    # Bullish tailwinds (low VIX, positive momentum) should ease bearishness too,
    # so the same adjustment is applied in the opposite direction.
    raw_bear_forecast = avg_bear_pct_3d - vix_adjustment - nifty_adjustment
    forecast_bear_pct = round(_clamp(raw_bear_forecast, 0, 100), 2)
    forecast_label = _classify(forecast_bull_pct, forecast_bear_pct)

    days = [
        ForecastDay(
            date=(week_start_date + timedelta(days=i)).isoformat(),
            weekday=_WEEKDAY_NAMES[i],
            forecast_bull_pct=forecast_bull_pct,
            forecast_label=forecast_label,
        )
        for i in range(5)
    ]

    forecast = WeeklySentimentForecast(
        week_start=week_start,
        generated_at=datetime.now(UTC),
        inputs={
            "avg_bull_pct_3d": avg_bull_pct_3d,
            "avg_bear_pct_3d": avg_bear_pct_3d,
            "days_of_history_used": len(recent),
            "vix_value": vix_value,
            "vix_adjustment": round(vix_adjustment, 2),
            "nifty_momentum_pct": nifty_momentum_pct,
            "nifty_adjustment": round(nifty_adjustment, 2),
            "forecast_bear_pct": forecast_bear_pct,
        },
        days=days,
    )
    await repo.save_forecast(forecast)

    # Backfill actuals for any days already in the past (e.g. regenerating mid-week).
    # Mutate `days` in place too, not just the DB, so the object this function
    # returns reflects the same backfilled actuals a fresh read would show.
    for day in days:
        snap = await repo.get_snapshot(day.date)
        if snap:
            resolved = await repo.resolve_forecast_day(
                week_start, day.date, snap["bull_pct"], snap["label"]
            )
            if resolved:
                day.actual_bull_pct = snap["bull_pct"]
                day.actual_label = snap["label"]
                day.label_match = day.forecast_label == snap["label"]
                day.error_pct = round(abs(day.forecast_bull_pct - snap["bull_pct"]), 2)
                day.resolved_at = datetime.now(UTC).isoformat()

    return forecast


def _week_accuracy(days: list[dict]) -> dict:
    resolved = [d for d in days if d.get("actual_label") is not None]
    correct = [d for d in resolved if d.get("label_match")]
    avg_error = (
        round(sum(d["error_pct"] for d in resolved) / len(resolved), 2) if resolved else None
    )
    return {
        "days_resolved": len(resolved),
        "days_correct": len(correct),
        "accuracy_pct": round(len(correct) / len(resolved) * 100, 1) if resolved else None,
        "avg_error_pct": avg_error,
    }


async def get_week_view(week_start_str: str | None = None) -> dict | None:
    repo = SentimentForecastRepository()
    week_start = week_start_str or _week_start(date.today()).isoformat()
    forecast = await repo.get_forecast(week_start)
    if not forecast:
        return None
    return {**forecast, "accuracy": _week_accuracy(forecast["days"])}


async def get_forecast_history(limit: int = 12) -> list[dict]:
    repo = SentimentForecastRepository()
    weeks = await repo.list_forecast_history(limit=limit)
    return [{**w, "accuracy": _week_accuracy(w["days"])} for w in weeks]

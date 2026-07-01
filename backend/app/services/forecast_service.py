"""Orchestrates ML forecast + Claude agent analysis + persistence."""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import structlog

from app.domain.models.forecast import ForecastResult, HorizonForecast

log = structlog.get_logger()

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


async def _claude_analysis(
    symbol: str,
    name: str,
    current_price: float,
    forecasts: list[HorizonForecast],
) -> str:
    try:
        from anthropic import AsyncAnthropic

        from app.core.config import settings

        lines = []
        for f in forecasts:
            model_summary = ", ".join(
                f"{m.model.replace('_', ' ')} ₹{m.predicted_price:.2f}"
                for m in f.models
            )
            lines.append(
                f"  {f.horizon.title():6s} ({f.horizon_days}d): "
                f"ensemble ₹{f.ensemble_price:.2f} ({f.ensemble_change_pct:+.2f}%) "
                f"[{f.direction}] | {model_summary}"
            )

        prompt = (
            f"You are a concise Indian equity analyst. "
            f"Given these ML price predictions for {symbol} ({name}), "
            f"write a 3-sentence market analysis.\n\n"
            f"Current price: ₹{current_price:.2f}\n\n"
            f"ML Predictions:\n" + "\n".join(lines) + "\n\n"
            "Write exactly 3 sentences: "
            "(1) What the model consensus says about direction and magnitude. "
            "(2) Key technical factor that most supports this view. "
            "(3) Main risk that could invalidate the prediction. "
            "Be specific with numbers. No bullet points, no headers."
        )

        client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=220,
            messages=[{"role": "user", "content": prompt}],
        )
        return str(resp.content[0].text).strip()
    except Exception as exc:
        log.warning("forecast.claude.failed", error=str(exc))
        return "AI agent analysis unavailable — models ran successfully above."


async def generate_forecast(symbol: str) -> ForecastResult:
    import yfinance as yf

    from app.infra.ml.forecaster import forecast as ml_forecast

    # ── Fetch live metadata ──────────────────────────────────────────────────
    ticker = yf.Ticker(symbol)
    current_price = 0.0
    prev_close = 0.0
    high_52w = 0.0
    low_52w = 0.0
    volume = 0
    name_str = symbol

    try:
        info = ticker.info
        name_str      = info.get("longName") or info.get("shortName") or symbol
        current_price = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        prev_close    = float(
            info.get("regularMarketPreviousClose") or info.get("previousClose") or 0
        )
        high_52w      = float(info.get("fiftyTwoWeekHigh") or 0)
        low_52w       = float(info.get("fiftyTwoWeekLow") or 0)
        volume        = int(info.get("averageVolume") or 0)
    except Exception as exc:
        log.warning("forecast.info.failed", symbol=symbol, error=str(exc))

    # Fallback: use last close from history if info failed
    if not current_price:
        try:
            hist = ticker.history(period="5d")
            if not hist.empty:
                current_price = float(hist["Close"].iloc[-1])
                if len(hist) >= 2:
                    prev_close = float(hist["Close"].iloc[-2])
                if not high_52w:
                    year_hist = ticker.history(period="1y")
                    if not year_hist.empty:
                        high_52w = float(year_hist["Close"].max())
                        low_52w  = float(year_hist["Close"].min())
        except Exception as exc:
            log.warning("forecast.history_fallback.failed", symbol=symbol, error=str(exc))

    if not prev_close:
        prev_close = current_price
    day_change_pct = (current_price - prev_close) / (prev_close + 1e-9) * 100

    week_change_pct = 0.0
    try:
        hist7 = ticker.history(period="7d")
        if len(hist7) >= 2:
            w0 = float(hist7["Close"].iloc[0])
            week_change_pct = (current_price - w0) / (w0 + 1e-9) * 100
    except Exception:
        pass

    # ── ML forecast ──────────────────────────────────────────────────────────
    forecasts = await ml_forecast(symbol)

    # ── Claude agent analysis ────────────────────────────────────────────────
    analysis = await _claude_analysis(symbol, name_str, current_price, forecasts)

    result = ForecastResult(
        id=uuid4(),
        symbol=symbol,
        name=name_str,
        current_price=round(current_price, 2),
        prev_close=round(prev_close, 2),
        day_change_pct=round(day_change_pct, 2),
        week_change_pct=round(week_change_pct, 2),
        high_52w=round(high_52w, 2),
        low_52w=round(low_52w, 2),
        volume=volume,
        avg_volume=volume,
        forecasts=forecasts,
        agent_analysis=analysis,
        generated_at=datetime.now(UTC).replace(tzinfo=None),
    )

    # Persist (fire-and-forget)
    try:
        from app.infra.db.repositories.forecast_repo import ForecastRepository
        repo = ForecastRepository()
        await repo.save_result(result)

        # Save individual prediction records for accuracy tracking
        records = []
        for f in forecasts:
            for m in f.models:
                records.append({
                    "symbol": symbol,
                    "horizon": f.horizon,
                    "horizon_days": f.horizon_days,
                    "model": m.model,
                    "predicted_price": m.predicted_price,
                    "predicted_change_pct": m.change_pct,
                    "direction": m.direction,
                    "base_price": current_price,
                    "target_date": f.target_date,
                    "generated_at": result.generated_at.isoformat(),
                    "actual_price": None,
                    "error_pct": None,
                    "direction_correct": None,
                    "resolved_at": None,
                })
        await repo.save_accuracy_records(records)
    except Exception as exc:
        log.warning("forecast.persist.failed", error=str(exc))

    return result

"""Anthropic Claude integration for trading signal generation."""

import json
import re

import structlog
from anthropic import AsyncAnthropic

from app.domain.models.quote import Quote
from app.domain.models.recommendation import AIRecommendation
from app.infra.ai.technical import TechnicalIndicators

log = structlog.get_logger()

_MODEL = "claude-haiku-4-5-20251001"


def _build_prompt(symbol: str, quote: Quote, ta: TechnicalIndicators) -> str:
    rsi_label = "overbought" if ta.rsi_14 > 70 else "oversold" if ta.rsi_14 < 30 else "neutral"
    macd_label = "bullish" if ta.macd > ta.macd_signal else "bearish"
    sma50_line = f"- SMA-50: ₹{ta.sma_50:.2f}" if ta.sma_50 else "- SMA-50: insufficient data"
    trend_label = ta.trend.replace("_", " ").title()

    return f"""You are an expert Indian equity analyst specialising in NSE/BSE short-term trading.

Analyse {symbol} and provide a short-term (1–5 day) trading recommendation.

## Current Market Data
- Price: ₹{quote.price:.2f}
- Change today: {quote.change:+.2f} ({quote.change_pct:+.2f}%)
- Day range: ₹{quote.day_low:.2f} – ₹{quote.day_high:.2f}
- Volume vs 20-day avg: {ta.volume_ratio:.2f}×

## Technical Indicators
- Trend: {trend_label}
- SMA-20: ₹{ta.sma_20:.2f} (price is {ta.price_vs_sma20_pct:+.1f}% vs SMA-20)
{sma50_line}
- RSI-14: {ta.rsi_14:.1f} ({rsi_label})
- MACD: {ta.macd:.3f} | Signal: {ta.macd_signal:.3f} ({macd_label} momentum)
- Bollinger Bands: ₹{ta.bb_lower:.2f} – ₹{ta.bb_upper:.2f}
- ATR-14: ₹{ta.atr_14:.2f} ({ta.atr_14 / quote.price * 100:.2f}% of price)

Respond with ONLY a valid JSON object — no other text, no markdown fences:
{{
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": <float 0.0–1.0>,
  "entry_price": <based on current ₹{quote.price:.2f}>,
  "stop_loss": <BUY: below entry | SELL: above entry>,
  "target": <BUY: above entry | SELL: below entry>,
  "risk_reward_ratio": <|target-entry| / |entry-stop_loss|, min 1.5>,
  "holding_period": "<e.g. '2–3 days'>",
  "explanation": "<2 sentences: key reason for signal + main risk>"
}}

Hard rules:
- BUY: stop_loss < entry_price < target
- SELL: target < entry_price < stop_loss
- HOLD: use hypothetical BUY scenario for price levels
- Keep stop within 5% of entry; target within 10% of entry
- Confidence range 0.45–0.85 (never false certainty)"""


def _extract_json(text: str) -> dict:
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    try:
        return json.loads(text)  # type: ignore[no-any-return]
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group())  # type: ignore[no-any-return]
        raise ValueError("Cannot parse Claude response as JSON") from None


class ClaudeAIClient:
    def __init__(self, api_key: str) -> None:
        self._client = AsyncAnthropic(api_key=api_key)

    async def analyze(
        self, symbol: str, quote: Quote, ta: TechnicalIndicators
    ) -> AIRecommendation:
        prompt = _build_prompt(symbol, quote, ta)
        log.info("ai.analyze.start", symbol=symbol)

        msg = await self._client.messages.create(
            model=_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw: str = msg.content[0].text  # type: ignore[union-attr]
        log.info("ai.analyze.done", symbol=symbol, snippet=raw[:120])

        data = _extract_json(raw)

        signal = str(data.get("signal", "HOLD")).upper()
        if signal not in ("BUY", "SELL", "HOLD"):
            signal = "HOLD"

        entry = float(data.get("entry_price", quote.price))
        stop = float(data.get("stop_loss", quote.price * 0.97))
        target = float(data.get("target", quote.price * 1.05))
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        risk = abs(entry - stop)
        reward = abs(target - entry)
        rr = round(reward / risk, 2) if risk > 0 else 0.0

        return AIRecommendation(
            symbol=symbol,
            signal=signal,
            confidence=confidence,
            entry_price=round(entry, 2),
            stop_loss=round(stop, 2),
            target=round(target, 2),
            risk_reward_ratio=rr,
            holding_period=str(data.get("holding_period", "2–5 days")),
            explanation=str(data.get("explanation", "")),
            engine="claude",
        )

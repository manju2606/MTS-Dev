"""Liquidity Flow engine: deterministic Smart Money Concepts analytics.

Pure Python. No framework or I/O imports (CLAUDE.md domain rule).

Conventions
- Candles are sorted ascending by time and contain closed bars only.
- A pivot is only treated as known once its right-side candles have closed
  (confirm_index). Nothing uses future candles, so the output is the same as
  it would have been live.
- The numerical rules are the source of truth. No LLM is involved here.
- Output is analytics for research. It is not an order instruction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Candle:
    time: int  # unix seconds
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Pivot:
    kind: str  # "high" | "low"
    index: int
    price: float
    time: int
    confirm_index: int
    # 0..1: lead over the nearest rival swing in the window, as a share of the
    # window's range. Larger means a more prominent swing.
    strength: float = 0.0


@dataclass(frozen=True)
class StructureEvent:
    kind: str  # BOS_UP | BOS_DOWN | CHOCH_UP | CHOCH_DOWN
    index: int
    time: int
    level: float  # structural level that was broken
    close: float
    origin_index: int | None  # swing that started the impulse (for order blocks)


@dataclass
class OrderBlock:
    side: str  # bullish | bearish
    index: int
    time: int
    top: float
    bottom: float
    status: str  # active | mitigated
    source_event: str  # the structure event kind that created it


@dataclass
class LiquidityPool:
    side: str  # buy_side (above price) | sell_side (below price)
    level: float
    touches: int
    last_index: int
    last_time: int


@dataclass
class Sweep:
    side: str  # bullish (sell-side swept, reversal up) | bearish (buy-side swept, reversal down)
    index: int
    time: int
    level: float
    wick_extreme: float


@dataclass(frozen=True)
class EngineConfig:
    pivot_left: int = 3
    pivot_right: int = 3
    equal_tolerance_pct: float = 0.15  # highs/lows within this % count as "equal"
    max_order_blocks: int = 5
    max_pools_per_side: int = 4
    sweep_lookback: int = 20
    recent_sweep_bars: int = 5
    atr_period: int = 14
    min_bars: int = 40
    min_rr: float = 1.5
    directional_threshold: float = 0.30  # net score needed to call BUY/SELL


@dataclass
class LiquidityAnalysis:
    last_close: float
    atr: float
    n_bars: int
    trend: str  # bullish | bearish | undefined
    structure_events: list[StructureEvent] = field(default_factory=list)
    order_blocks: list[OrderBlock] = field(default_factory=list)
    liquidity_pools: list[LiquidityPool] = field(default_factory=list)
    sweeps: list[Sweep] = field(default_factory=list)
    swing_highs: list[Pivot] = field(default_factory=list)
    swing_lows: list[Pivot] = field(default_factory=list)
    recommendation: dict[str, Any] = field(default_factory=dict)


# ── Building blocks ──────────────────────────────────────────────────────────


def compute_atr(candles: list[Candle], period: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    trs: list[float] = []
    for prev, cur in zip(candles[:-1], candles[1:], strict=True):
        trs.append(
            max(
                cur.high - cur.low,
                abs(cur.high - prev.close),
                abs(cur.low - prev.close),
            )
        )
    window = trs[-period:]
    return sum(window) / len(window) if window else 0.0


def find_pivots(candles: list[Candle], left: int, right: int) -> list[Pivot]:
    """Fractal swing points. A pivot at i needs `left` lower highs before it and
    `right` lower highs after it. It is confirmed at i + right."""
    pivots: list[Pivot] = []
    n = len(candles)
    for i in range(left, n - right):
        window = range(i - left, i + right + 1)
        neighbours = [j for j in window if j != i]
        h = candles[i].high
        lo = candles[i].low
        if all(h > candles[j].high for j in neighbours):
            span = max(candles[j].high for j in window) - min(candles[j].low for j in window)
            margin = h - max(candles[j].high for j in neighbours)  # lead over nearest rival high
            strength = 0.0 if span <= 0 else margin / span
            pivots.append(Pivot("high", i, h, candles[i].time, i + right, round(strength, 3)))
        if all(lo < candles[j].low for j in neighbours):
            span = max(candles[j].high for j in window) - min(candles[j].low for j in window)
            margin = min(candles[j].low for j in neighbours) - lo  # lead over nearest rival low
            strength = 0.0 if span <= 0 else margin / span
            pivots.append(Pivot("low", i, lo, candles[i].time, i + right, round(strength, 3)))
    pivots.sort(key=lambda p: (p.index, p.kind))
    return pivots


def detect_structure(
    candles: list[Candle], pivots: list[Pivot]
) -> tuple[list[StructureEvent], str]:
    """BOS = close beyond the last swing in the trend direction.
    CHoCH = close beyond the last swing against the prevailing trend.
    Each swing is consumed once it is broken."""
    events: list[StructureEvent] = []
    trend = "undefined"
    last_high: Pivot | None = None
    last_low: Pivot | None = None
    ordered = sorted(pivots, key=lambda p: p.confirm_index)
    pi = 0

    for i, c in enumerate(candles):
        while pi < len(ordered) and ordered[pi].confirm_index < i:
            p = ordered[pi]
            pi += 1
            if p.kind == "high":
                last_high = p
            else:
                last_low = p

        if last_high is not None and c.close > last_high.price:
            kind = "CHOCH_UP" if trend == "bearish" else "BOS_UP"
            events.append(
                StructureEvent(
                    kind,
                    i,
                    c.time,
                    last_high.price,
                    c.close,
                    origin_index=last_low.index if last_low else None,
                )
            )
            trend = "bullish"
            last_high = None
        elif last_low is not None and c.close < last_low.price:
            kind = "CHOCH_DOWN" if trend == "bullish" else "BOS_DOWN"
            events.append(
                StructureEvent(
                    kind,
                    i,
                    c.time,
                    last_low.price,
                    c.close,
                    origin_index=last_high.index if last_high else None,
                )
            )
            trend = "bearish"
            last_low = None

    return events, trend


def build_order_blocks(
    candles: list[Candle], events: list[StructureEvent], max_blocks: int
) -> list[OrderBlock]:
    """Bullish OB = last down-close candle inside the impulse that broke structure
    upward. Bearish OB is the mirror image. A block is mitigated once a later
    close trades through it."""
    blocks: list[OrderBlock] = []
    seen: set[int] = set()
    for ev in events:
        if ev.origin_index is None or ev.index in seen:
            continue
        bullish = ev.kind in ("BOS_UP", "CHOCH_UP")
        found: int | None = None
        for j in range(ev.index - 1, ev.origin_index - 1, -1):
            c = candles[j]
            if (bullish and c.close < c.open) or (not bullish and c.close > c.open):
                found = j
                break
        if found is None:
            continue
        seen.add(ev.index)
        ob = candles[found]
        top, bottom = ob.high, ob.low
        mitigated = False
        for k in range(found + 1, len(candles)):
            if bullish and candles[k].close < bottom:
                mitigated = True
                break
            if not bullish and candles[k].close > top:
                mitigated = True
                break
        blocks.append(
            OrderBlock(
                side="bullish" if bullish else "bearish",
                index=found,
                time=ob.time,
                top=top,
                bottom=bottom,
                status="mitigated" if mitigated else "active",
                source_event=ev.kind,
            )
        )
    blocks.sort(key=lambda b: b.index, reverse=True)
    return blocks[:max_blocks]


def build_liquidity_pools(
    candles: list[Candle],
    pivots: list[Pivot],
    tolerance_pct: float,
    last_price: float,
    max_per_side: int,
) -> list[LiquidityPool]:
    """Equal highs (buy-side) and equal lows (sell-side) are clusters of same-kind
    swings within tolerance. The latest unbroken swing on each side is also kept
    as a single-touch pool. A pool is removed once a later close trades through it."""
    pools: list[LiquidityPool] = []
    for kind, side in (("high", "buy_side"), ("low", "sell_side")):
        pts = sorted((p for p in pivots if p.kind == kind), key=lambda p: p.price)
        clusters: list[list[Pivot]] = []
        for p in pts:
            if clusters and abs(p.price - clusters[-1][-1].price) / p.price * 100 <= tolerance_pct:
                clusters[-1].append(p)
            else:
                clusters.append([p])

        candidates: list[list[Pivot]] = [c for c in clusters if len(c) >= 2]
        latest = max((p for p in pts), key=lambda p: p.index, default=None)
        if latest is not None:
            candidates.append([latest])

        for cl in candidates:
            level = sum(p.price for p in cl) / len(cl)
            last_idx = max(p.index for p in cl)
            broken = False
            for k in range(last_idx + 1, len(candles)):
                if side == "buy_side" and candles[k].close > level:
                    broken = True
                    break
                if side == "sell_side" and candles[k].close < level:
                    broken = True
                    break
            if broken:
                continue
            pools.append(
                LiquidityPool(
                    side=side,
                    level=round(level, 2),
                    touches=len(cl),
                    last_index=last_idx,
                    last_time=candles[last_idx].time,
                )
            )

    above = sorted(
        (p for p in pools if p.side == "buy_side" and p.level > last_price), key=lambda p: p.level
    )[:max_per_side]
    below = sorted(
        (p for p in pools if p.side == "sell_side" and p.level < last_price),
        key=lambda p: p.level,
        reverse=True,
    )[:max_per_side]
    return above + below


def detect_sweeps(candles: list[Candle], pivots: list[Pivot], lookback: int) -> list[Sweep]:
    """Wick through a known swing, then close back inside it. Buy-side sweep = wick
    above a swing high with a close below it (bearish). Sell-side sweep = wick below
    a swing low with a close above it (bullish)."""
    sweeps: list[Sweep] = []
    start = max(0, len(candles) - lookback)
    for i in range(start, len(candles)):
        c = candles[i]
        known_highs = [p for p in pivots if p.kind == "high" and p.confirm_index < i]
        known_lows = [p for p in pivots if p.kind == "low" and p.confirm_index < i]
        if known_highs:
            ref = max(known_highs, key=lambda p: p.index)
            if c.high > ref.price and c.close < ref.price:
                sweeps.append(Sweep("bearish", i, c.time, ref.price, c.high))
        if known_lows:
            ref = max(known_lows, key=lambda p: p.index)
            if c.low < ref.price and c.close > ref.price:
                sweeps.append(Sweep("bullish", i, c.time, ref.price, c.low))
    return sweeps


# ── Recommendation ───────────────────────────────────────────────────────────


def build_recommendation(
    analysis: LiquidityAnalysis,
    cfg: EngineConfig,
    holding_period: str,
) -> dict[str, Any]:
    """Net score = bullish evidence minus bearish evidence, each term additive:
      trend (structure)          0.35
      price inside/near active OB 0.25
      recent sweep in direction   0.25
    BUY if net >= threshold, SELL if net <= -threshold, else HOLD.
    Confidence = min(0.95, |net|). Levels follow the stronger side even on HOLD,
    so every field stays populated."""
    price = analysis.last_close
    atr = analysis.atr or price * 0.01
    reasons: list[str] = []
    bull = 0.0
    bear = 0.0

    if analysis.trend == "bullish":
        bull += 0.35
        reasons.append("Structure is bullish (last break was upward)")
    elif analysis.trend == "bearish":
        bear += 0.35
        reasons.append("Structure is bearish (last break was downward)")

    near = 1.0 * atr
    bull_obs = [
        b
        for b in analysis.order_blocks
        if b.side == "bullish"
        and b.status == "active"
        and b.bottom - near <= price <= b.top + 0.5 * atr
    ]
    bear_obs = [
        b
        for b in analysis.order_blocks
        if b.side == "bearish"
        and b.status == "active"
        and b.bottom - 0.5 * atr <= price <= b.top + near
    ]
    if bull_obs:
        bull += 0.25
        ob = bull_obs[0]
        reasons.append(f"Price is at an active bullish order block ({ob.bottom:.2f}–{ob.top:.2f})")
    if bear_obs:
        bear += 0.25
        ob = bear_obs[0]
        reasons.append(f"Price is at an active bearish order block ({ob.bottom:.2f}–{ob.top:.2f})")

    recent = [s for s in analysis.sweeps if s.index >= analysis.n_bars - cfg.recent_sweep_bars]
    if any(s.side == "bullish" for s in recent):
        bull += 0.25
        reasons.append(
            "Recent sell-side liquidity sweep (stops below a swing low were taken, "
            "price reclaimed it)"
        )
    if any(s.side == "bearish" for s in recent):
        bear += 0.25
        reasons.append(
            "Recent buy-side liquidity sweep (stops above a swing high were taken, "
            "price rejected it)"
        )

    net = round(bull - bear, 2)
    if net >= cfg.directional_threshold:
        side = "BUY"
    elif net <= -cfg.directional_threshold:
        side = "SELL"
    else:
        side = "HOLD"
    confidence = round(min(0.95, abs(net)), 2)

    lean_long = net >= 0
    entry = price
    if lean_long:
        supports = [
            b.bottom
            for b in analysis.order_blocks
            if b.side == "bullish" and b.status == "active" and b.bottom < price
        ]
        supports += [p.price for p in analysis.swing_lows if p.price < price]
        base_stop = max(supports) if supports else price - 1.5 * atr
        stop = round(min(base_stop - 0.2 * atr, price - 0.5 * atr), 2)
        risk = entry - stop
        targets = [p.price for p in analysis.swing_highs if p.price > price * 1.001]
        targets += [
            pool.level
            for pool in analysis.liquidity_pools
            if pool.side == "buy_side" and pool.level > price * 1.001
        ]
        target = round(min(targets), 2) if targets else round(entry + 2 * risk, 2)
    else:
        resists = [
            b.top
            for b in analysis.order_blocks
            if b.side == "bearish" and b.status == "active" and b.top > price
        ]
        resists += [p.price for p in analysis.swing_highs if p.price > price]
        base_stop = min(resists) if resists else price + 1.5 * atr
        stop = round(max(base_stop + 0.2 * atr, price + 0.5 * atr), 2)
        risk = stop - entry
        targets = [p.price for p in analysis.swing_lows if p.price < price * 0.999]
        targets += [
            pool.level
            for pool in analysis.liquidity_pools
            if pool.side == "sell_side" and pool.level < price * 0.999
        ]
        target = round(max(targets), 2) if targets else round(entry - 2 * risk, 2)

    risk = abs(entry - stop) or 1e-9
    rr = round(abs(target - entry) / risk, 2)

    if side in ("BUY", "SELL") and rr < cfg.min_rr:
        reasons.append(
            f"Reward-to-risk {rr} is below the {cfg.min_rr} minimum, "
            "so the signal is downgraded to HOLD"
        )
        side = "HOLD"

    if side == "HOLD" and not reasons:
        reasons.append(
            "No clear structural edge: trend, order block and sweep evidence do not agree"
        )

    direction_word = "bullish" if lean_long else "bearish"
    explanation = (
        f"{side}: net score {net:+.2f} (bullish {bull:.2f} vs bearish {bear:.2f}). "
        + ("; ".join(reasons) + ". " if reasons else "")
        + f"Levels follow the {direction_word} side (entry = last close, ATR {atr:.2f}). "
        + "Analytics only, not investment advice."
    )

    return {
        "signal": side,
        "confidence": confidence,
        "entry_price": round(entry, 2),
        "stop_loss": stop,
        "target": target,
        "risk_reward_ratio": rr,
        "holding_period": holding_period,
        "explanation": explanation,
        "net_score": net,
        "bullish_score": round(bull, 2),
        "bearish_score": round(bear, 2),
    }


# ── Entry point ──────────────────────────────────────────────────────────────


def analyze(
    candles: list[Candle],
    holding_period: str = "1–5 sessions",
    cfg: EngineConfig | None = None,
) -> LiquidityAnalysis:
    cfg = cfg or EngineConfig()
    if len(candles) < cfg.min_bars:
        raise ValueError(f"Need at least {cfg.min_bars} closed candles, got {len(candles)}")

    pivots = find_pivots(candles, cfg.pivot_left, cfg.pivot_right)
    events, trend = detect_structure(candles, pivots)
    order_blocks = build_order_blocks(candles, events, cfg.max_order_blocks)
    last_price = candles[-1].close
    pools = build_liquidity_pools(
        candles, pivots, cfg.equal_tolerance_pct, last_price, cfg.max_pools_per_side
    )
    sweeps = detect_sweeps(candles, pivots, cfg.sweep_lookback)

    analysis = LiquidityAnalysis(
        last_close=last_price,
        atr=round(compute_atr(candles, cfg.atr_period), 4),
        n_bars=len(candles),
        trend=trend,
        structure_events=events[-20:],
        order_blocks=order_blocks,
        liquidity_pools=pools,
        sweeps=sweeps,
        swing_highs=[p for p in pivots if p.kind == "high"][-10:],
        swing_lows=[p for p in pivots if p.kind == "low"][-10:],
    )
    analysis.recommendation = build_recommendation(analysis, cfg, holding_period)
    return analysis

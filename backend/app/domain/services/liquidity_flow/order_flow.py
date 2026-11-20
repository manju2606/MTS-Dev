"""Order-flow analytics. Pure Python, no I/O.

Two kinds of input are handled and labelled differently:

1. OHLCV-derived ESTIMATES (always available from candles):
   - Volume profile (POC, value area) from bar volume spread over each bar's range.
   - Cumulative Volume Delta (CVD) estimated from where each close sits in its range.
   These are estimates. They are not true buy/sell volume.

2. TRUE order-flow analytics (need a tick or depth feed):
   - Footprint: traded volume split bid vs ask per price level from trade prints.
   - Stacked imbalances per price level.
   - Bid/ask depth imbalance from order-book snapshots.
   These functions are complete and tested, but they only produce output when
   the caller passes real trade or depth data.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.services.liquidity_flow.engine import Candle


@dataclass(frozen=True)
class Trade:
    price: float
    qty: float
    aggressor: str  # "B" = buyer lifted the ask (ask volume), "S" = seller hit the bid (bid volume)


@dataclass(frozen=True)
class DepthLevel:
    price: float
    qty: float


# ── OHLCV-derived estimates ──────────────────────────────────────────────────


@dataclass
class VolumeBucket:
    low: float
    high: float
    volume: float


@dataclass
class VolumeProfile:
    buckets: list[VolumeBucket] = field(default_factory=list)
    poc: float | None = None  # price with the most volume
    value_area_high: float | None = None
    value_area_low: float | None = None
    total_volume: float = 0.0
    method: str = "ohlc_estimate"


def volume_profile(
    candles: list[Candle], bins: int = 24, value_area_pct: float = 0.70
) -> VolumeProfile:
    """Spread each bar's volume evenly across the price bins its high-low range covers.
    The value area is the smallest band around the POC holding `value_area_pct` of volume."""
    if not candles:
        return VolumeProfile()
    lo = min(c.low for c in candles)
    hi = max(c.high for c in candles)
    if hi <= lo or bins < 1:
        return VolumeProfile()
    step = (hi - lo) / bins
    vols = [0.0] * bins

    for c in candles:
        if c.volume <= 0:
            continue
        first = min(bins - 1, max(0, int((c.low - lo) / step)))
        last = min(bins - 1, max(0, int((c.high - lo) / step)))
        span = last - first + 1
        share = c.volume / span
        for b in range(first, last + 1):
            vols[b] += share

    total = sum(vols)
    if total <= 0:
        return VolumeProfile()

    buckets = [
        VolumeBucket(
            low=round(lo + b * step, 2), high=round(lo + (b + 1) * step, 2), volume=round(v, 2)
        )
        for b, v in enumerate(vols)
    ]
    poc_idx = max(range(bins), key=lambda b: vols[b])

    # Expand outward from the POC, adding the heavier neighbour, until the target share is reached.
    included = {poc_idx}
    acc = vols[poc_idx]
    up, down = poc_idx + 1, poc_idx - 1
    target = total * value_area_pct
    while acc < target and (up < bins or down >= 0):
        up_v = vols[up] if up < bins else -1.0
        down_v = vols[down] if down >= 0 else -1.0
        if up_v >= down_v:
            included.add(up)
            acc += up_v
            up += 1
        else:
            included.add(down)
            acc += down_v
            down -= 1

    return VolumeProfile(
        buckets=buckets,
        poc=round(lo + (poc_idx + 0.5) * step, 2),
        value_area_high=round(lo + (max(included) + 1) * step, 2),
        value_area_low=round(lo + min(included) * step, 2),
        total_volume=round(total, 2),
    )


def estimated_cvd(candles: list[Candle]) -> list[dict[str, float]]:
    """Estimated per-bar delta: volume * (close position in range, mapped to -1..+1).
    A close at the high counts as all buying, a close at the low as all selling.
    The cumulative sum is the CVD line. It is an estimate, not true aggressor volume."""
    out: list[dict[str, float]] = []
    running = 0.0
    for c in candles:
        rng = c.high - c.low
        pos = 0.0 if rng <= 0 else ((c.close - c.low) - (c.high - c.close)) / rng
        delta = c.volume * pos
        running += delta
        out.append({"time": c.time, "delta": round(delta, 2), "cvd": round(running, 2)})
    return out


# ── True order-flow (requires a tick / depth feed) ───────────────────────────


@dataclass
class FootprintLevel:
    price: float
    bid_volume: float  # sold into the bid
    ask_volume: float  # bought off the ask
    delta: float
    imbalance: str | None  # "buy" | "sell" | None


@dataclass
class Footprint:
    levels: list[FootprintLevel] = field(default_factory=list)
    stacked_buy: list[float] = field(default_factory=list)
    stacked_sell: list[float] = field(default_factory=list)
    total_delta: float = 0.0


def footprint(
    trades: list[Trade],
    tick_size: float,
    imbalance_ratio: float = 3.0,
    stack_len: int = 3,
) -> Footprint:
    """Aggregate trade prints into price levels. An imbalance is ask >= ratio * bid (buy)
    or bid >= ratio * ask (sell). A stacked imbalance is `stack_len` consecutive
    imbalanced levels in the same direction."""
    if tick_size <= 0:
        raise ValueError("tick_size must be positive")
    bid: dict[float, float] = {}
    ask: dict[float, float] = {}
    for t in trades:
        key = round(round(t.price / tick_size) * tick_size, 4)
        if t.aggressor == "B":
            ask[key] = ask.get(key, 0.0) + t.qty
        elif t.aggressor == "S":
            bid[key] = bid.get(key, 0.0) + t.qty
    prices = sorted(set(bid) | set(ask))
    levels: list[FootprintLevel] = []
    for p in prices:
        b = bid.get(p, 0.0)
        a = ask.get(p, 0.0)
        tag: str | None = None
        if a > 0 and a >= imbalance_ratio * max(b, 1e-9):
            tag = "buy"
        elif b > 0 and b >= imbalance_ratio * max(a, 1e-9):
            tag = "sell"
        levels.append(FootprintLevel(p, round(b, 2), round(a, 2), round(a - b, 2), tag))

    fp = Footprint(levels=levels, total_delta=round(sum(lv.delta for lv in levels), 2))

    def _flush(kind: str | None, run: list[float]) -> None:
        if kind is None or len(run) < stack_len:
            return
        (fp.stacked_buy if kind == "buy" else fp.stacked_sell).append(run[0])

    run: list[float] = []
    run_kind: str | None = None
    prev_price: float | None = None
    for lv in levels:
        adjacent = prev_price is not None and lv.price - prev_price <= tick_size * 1.5
        prev_price = lv.price
        if lv.imbalance is None or not adjacent or lv.imbalance != run_kind:
            _flush(run_kind, run)
            run, run_kind = ([lv.price], lv.imbalance) if lv.imbalance else ([], None)
            continue
        run.append(lv.price)
    _flush(run_kind, run)
    return fp


@dataclass
class DepthImbalance:
    bid_qty: float
    ask_qty: float
    ratio: float  # bid / ask; >1 means more resting bids
    bias: str  # "bid_heavy" | "ask_heavy" | "balanced"


def depth_imbalance(
    bids: list[DepthLevel], asks: list[DepthLevel], levels: int = 5
) -> DepthImbalance:
    """Compare resting quantity on the top `levels` of each side of the book."""
    bq = sum(lv.qty for lv in sorted(bids, key=lambda x: -x.price)[:levels])
    aq = sum(lv.qty for lv in sorted(asks, key=lambda x: x.price)[:levels])
    ratio = round(bq / aq, 3) if aq > 0 else float("inf")
    if ratio >= 1.5:
        bias = "bid_heavy"
    elif ratio <= 1 / 1.5:
        bias = "ask_heavy"
    else:
        bias = "balanced"
    return DepthImbalance(round(bq, 2), round(aq, 2), ratio, bias)

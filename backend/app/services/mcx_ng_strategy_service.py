"""MTS Natural Gas Strategy -- a dedicated multi-timeframe (1H trend / 15M
setup / 5M entry) intraday scorer for MCX Natural Gas Mini (NGMINI), giving
it the same BUY/SELL/STRONG BUY/STRONG SELL signal structure as
mcx_gold_strategy_service.py and mcx_silver_strategy_service.py. Distinct
from the existing NG-AI Pro score (mcx_ai_score_service.py) and the RSI
mean-reversion replay engine (mcx_rsi_signal_service.py) -- neither of those
uses this multi-timeframe scoring shape.

Reuses: mcx_service.get_history/get_quote for real Kite-backed candles (no
fabricated/substituted data source), app/infra/mcx/ng_indicators.py for the
indicator math, and _check/_category/_classify from mcx_ai_score_service.py
for the same category-scoring shape the rest of MCX AI scoring already uses.

Score (0-100), per category -- identical weighting to the Silver strategy
this is modeled on, since these are generic multi-timeframe TA categories,
not metal-specific ones:
  1H trend            20
  VWAP alignment       15
  EMA alignment        10
  RSI momentum         10
  15M pullback         10
  Reversal confirm     10
  Volume confirm       10
  PDH/PDL confirm      10
  5M confirmation       5

1H trend is a hard gate, not just a scored category: a neutral or opposing
1H trend means no trade regardless of how the lower timeframes score.

Signals are persisted through the existing McxSignalRepository (mcx_trade_signals
collection) under a synthetic contract key ("NGMINI_MTS") so they never mix
with the generic NG-AI Pro / RSI-strategy signals already tracked for plain
"NGMINI" -- same synthetic-key convention Gold/Silver Strategy already use.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from app.domain.models.mcx_silver_risk_state import SilverRiskConfig
from app.domain.services.mcx_silver_risk_gate import (
    check_can_trade,
    compute_daily_state,
    is_expiry_protected,
    is_within_session,
)
from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
from app.infra.mcx import ng_indicators as ind
from app.services.mcx_ai_score_service import _category, _check, _reason_for
from app.services.mcx_service import get_history as _get_history
from app.services.mcx_service import get_quote as _get_quote

_IST = ZoneInfo("Asia/Kolkata")

# Scoped to exactly the one contract this strategy was built for.
NG_STRATEGY_CONTRACTS: list[str] = ["NGMINI"]

# contract -> synthetic signal-tracking key (see module docstring).
_SIGNAL_CONTRACT_KEY: dict[str, str] = {c: f"{c}_MTS" for c in NG_STRATEGY_CONTRACTS}
_SIGNAL_KEY_TO_CONTRACT: dict[str, str] = {v: k for k, v in _SIGNAL_CONTRACT_KEY.items()}

MTS_SIGNAL_EXPIRY_DAYS = 5


@dataclass(frozen=True)
class MtsNgParams:
    """Every numeric threshold, same defaults as the Gold/Silver strategies
    this is modeled on."""

    hourly_rsi_bull_min: float = 55.0
    hourly_rsi_bear_max: float = 45.0
    setup_rsi_bull_min: float = 50.0
    setup_rsi_bear_max: float = 50.0
    volume_multiplier: float = 1.2
    atr_multiplier: float = 1.2
    strong_threshold: float = 85.0
    trade_threshold: float = 75.0
    watch_threshold: float = 65.0


ATR_MULTIPLIER_OPTIONS: list[float] = [0.8, 1.0, 1.2, 1.5, 2.0]


def _prev_day_levels(daily_candles: list[dict]) -> tuple[float, float, float] | None:
    """PDH/PDL/PDC from the last fully-closed daily candle."""
    if len(daily_candles) < 2:
        return None
    today = datetime.now(_IST).date()
    last = daily_candles[-1]
    last_date = datetime.fromtimestamp(last["time"], tz=_IST).date()
    prev = daily_candles[-2] if last_date == today else daily_candles[-1]
    return prev["high"], prev["low"], prev["close"]


def _hourly_trend(candles: list[dict], params: MtsNgParams) -> tuple[str, list[dict]]:
    c = ind.closes(candles)
    ema20, ema50 = ind.ema(c, 20), ind.ema(c, 50)
    rsi = ind.rsi(c, 14)
    if ema20 is None or ema50 is None or rsi is None:
        return "neutral", []

    price = c[-1]
    bullish = ema20 > ema50 and price > ema20 and rsi > params.hourly_rsi_bull_min
    bearish = ema20 < ema50 and price < ema20 and rsi < params.hourly_rsi_bear_max
    trend = "bullish" if bullish else "bearish" if bearish else "neutral"

    is_bear = trend == "bearish"
    ema_label = "1H EMA20 < EMA50 (downtrend)" if is_bear else "1H EMA20 > EMA50 (uptrend)"
    checks = [
        _check(
            ema_label, (ema20 < ema50) if is_bear else (ema20 > ema50), 8.0,
            f"EMA20={ema20:.2f} EMA50={ema50:.2f}",
        ),
        _check(
            "1H price vs EMA20", (price < ema20) if is_bear else (price > ema20), 6.0,
            f"price={price:.2f}",
        ),
        _check(
            "1H RSI momentum",
            rsi < params.hourly_rsi_bear_max if is_bear else rsi > params.hourly_rsi_bull_min,
            6.0, f"RSI={rsi:.1f}",
        ),
    ]
    return trend, checks


def _setup_15m(
    candles: list[dict],
    direction: str,
    pdh: float | None,
    pdl: float | None,
    params: MtsNgParams,
) -> dict:
    c, h, low = ind.closes(candles), ind.highs(candles), ind.lows(candles)
    vols = ind.volumes(candles)
    ema20 = ind.ema(c, 20)
    vwap = ind.vwap(candles)
    rsi = ind.rsi(c, 14)
    vol_spike = ind.volume_spike(vols, 20, params.volume_multiplier)
    reversal = ind.candlestick_confirmation(candles)
    structure = ind.swing_breakout(h, low, c, lookback=15)
    price = c[-1]
    bull = direction == "BUY"

    vwap_aligned = vwap is not None and ((price > vwap) if bull else (price < vwap))
    ema_aligned = ema20 is not None and ((price > ema20) if bull else (price < ema20))
    pulled_back = (
        ema20 is not None
        and vwap is not None
        and (min(abs(price - ema20), abs(price - vwap)) / price * 100 <= 1.0)
    )
    rsi_ok = rsi is not None and (
        rsi > params.setup_rsi_bull_min if bull else rsi < params.setup_rsi_bear_max
    )
    reversal_ok = reversal["bullish"] if bull else reversal["bearish"]
    structure_ok = structure["hh_hl"] if bull else structure["lh_ll"]
    volume_ok = bool(vol_spike and vol_spike[0])

    pdh_pdl_note = "no previous-day levels yet"
    pdh_pdl_ok = False
    if pdh is not None and pdl is not None:
        if bull:
            pdh_pdl_ok = price > pdh
            pdh_pdl_note = f"price {price:.2f} vs PDH {pdh:.2f}"
        else:
            pdh_pdl_ok = price < pdl
            pdh_pdl_note = f"price {price:.2f} vs PDL {pdl:.2f}"

    checks = [
        _check("15M VWAP alignment", vwap_aligned, 15.0, f"VWAP={vwap}" if vwap else "n/a"),
        _check("15M EMA20 alignment", ema_aligned, 10.0, f"EMA20={ema20}" if ema20 else "n/a"),
        _check("15M RSI momentum", rsi_ok, 10.0, f"RSI={rsi}" if rsi is not None else "n/a"),
        _check("15M pullback to EMA20/VWAP", pulled_back, 10.0,
               "within 1% of EMA20 or VWAP" if pulled_back else "extended from pullback zone"),
        _check("15M reversal candle / structure break", reversal_ok or structure_ok, 10.0,
               "engulfing/strong-close or HH-HL/LH-LL structure"),
        _check("15M volume vs 20-period average", volume_ok, 10.0,
               f"{vol_spike[1]}x average" if vol_spike else "n/a"),
        _check("Previous-day High/Low confirmation", pdh_pdl_ok, 10.0, pdh_pdl_note),
    ]
    return {"checks": checks, "price": price}


def _confirm_5m(candles: list[dict], direction: str, params: MtsNgParams) -> dict:
    c, h, low = ind.closes(candles), ind.highs(candles), ind.lows(candles)
    vols = ind.volumes(candles)
    ema9, ema20 = ind.ema(c, 9), ind.ema(c, 20)
    vwap = ind.vwap(candles)
    rsi = ind.rsi(c, 14)
    vol_spike = ind.volume_spike(vols, 20, params.volume_multiplier)
    price = c[-1]
    bull = direction == "BUY"

    ema_cross = ema9 is not None and ema20 is not None and (
        (ema9 > ema20) if bull else (ema9 < ema20)
    )
    vwap_ok = vwap is not None and ((price > vwap) if bull else (price < vwap))
    rsi_ok = rsi is not None and ((rsi > 55) if bull else (rsi < 45))
    volume_ok = bool(vol_spike and vol_spike[0])
    breakout_ok = len(candles) >= 2 and (
        (c[-1] > h[-2]) if bull else (c[-1] < low[-2])
    )

    passed = ema_cross and vwap_ok and rsi_ok and volume_ok and breakout_ok
    check = _check(
        "5M entry confirmation (EMA9/20, VWAP, RSI, volume, breakout)",
        passed, 5.0,
        f"EMA9/20={'OK' if ema_cross else 'no'} VWAP={'OK' if vwap_ok else 'no'} "
        f"RSI={'OK' if rsi_ok else 'no'} Vol={'OK' if volume_ok else 'no'} "
        f"Breakout={'OK' if breakout_ok else 'no'}",
    )
    return {"checks": [check], "price": price, "atr": ind.atr(h, low, c, 14)}


def build_ng_reasoning(
    categories: list[dict],
    direction: str,
    trend: str,
    price: float,
    stop_loss: float,
    target_1: float,
    target_2: float,
    atr_multiplier: float,
) -> dict:
    trend_reason = _reason_for(categories, ["1H Trend"], "1H Trend")
    setup_reason = _reason_for(
        categories,
        [
            "VWAP Alignment", "EMA Alignment", "RSI Momentum", "15M Pullback",
            "Reversal Confirmation", "Volume Confirmation", "PDH/PDL Confirmation",
        ],
        "15M Setup",
    )
    confirmation_reason = _reason_for(categories, ["5M Confirmation"], "5M Confirmation")

    opposite = "SELL" if direction == "BUY" else "BUY"
    bull = direction == "BUY"
    sl_distance = abs(round(price - stop_loss, 2))
    mirrored_target = round(price - sl_distance, 2) if bull else round(price + sl_distance, 2)
    mirrored_stop = round(price + sl_distance, 2) if bull else round(price - sl_distance, 2)
    alternative_scenario = (
        f"If this {direction} thesis is wrong and price instead moves like a {opposite} setup, "
        f"the mirrored case (same {atr_multiplier}x ATR distance) would target ~{mirrored_target} "
        f"with its own stop near {mirrored_stop} -- not a second signal, just what the opposite "
        "read looks like."
    )
    invalidation_level = (
        f"Invalidated on a close beyond {stop_loss} ({atr_multiplier}x ATR-14 on the 5M chart, "
        f"the same stop used for position sizing) -- or if the 1H trend ({trend}) flips before "
        "then, since that's a hard gate this score can't override. Target 1 is "
        f"{target_1} (1R, 50% exit + stop to breakeven), target 2 is {target_2} (2R, remainder)."
    )

    return {
        "trend_reason": trend_reason,
        "setup_reason": setup_reason,
        "confirmation_reason": confirmation_reason,
        "alternative_scenario": alternative_scenario,
        "invalidation_level": invalidation_level,
    }


def _classify_ng(score_pct: float, params: MtsNgParams) -> str:
    if score_pct >= params.strong_threshold:
        return "STRONG"
    if score_pct >= params.trade_threshold:
        return "TRADE"
    if score_pct >= params.watch_threshold:
        return "WATCH"
    return "NO_TRADE"


async def compute_ng_strategy_score(
    user_id: str,
    direction: str,
    contract: str = "NGMINI",
    capital: float = 100_000.0,
    account_risk_pct: float = 0.5,
    params: MtsNgParams | None = None,
) -> dict:
    """Full MTS Natural Gas Strategy breakdown for one direction on NGMINI.
    Raises ValueError if there isn't enough candle history yet."""
    if contract.upper() not in NG_STRATEGY_CONTRACTS:
        raise ValueError(
            f"MTS Natural Gas Strategy only covers {NG_STRATEGY_CONTRACTS}, got '{contract}'"
        )
    params = params or MtsNgParams()

    candles_1h = await _get_history(user_id, "1h", contract)
    candles_15m = await _get_history(user_id, "15m", contract)
    candles_5m = await _get_history(user_id, "5m", contract)
    daily = await _get_history(user_id, "1M", contract)

    if len(candles_1h) < 55 or len(candles_15m) < 25 or len(candles_5m) < 25:
        raise ValueError(
            f"Not enough MCX {contract} history yet (1H={len(candles_1h)}, "
            f"15M={len(candles_15m)}, 5M={len(candles_5m)} candles) -- need at least "
            "55/25/25 for a reliable multi-timeframe read. Try again once more of the "
            "trading day has passed."
        )

    trend, trend_checks = _hourly_trend(candles_1h, params)
    pd_levels = _prev_day_levels(daily)
    pdh, pdl, pdc = pd_levels if pd_levels else (None, None, None)

    setup = _setup_15m(candles_15m, direction, pdh, pdl, params)
    confirm = _confirm_5m(candles_5m, direction, params)

    trend_matches = (trend == "bullish" and direction == "BUY") or (
        trend == "bearish" and direction == "SELL"
    )

    trend_category = _category("1H Trend", 20, trend_checks, [])
    setup_checks = setup["checks"]
    categories = [
        trend_category,
        _category("VWAP Alignment", 15, [setup_checks[0]], []),
        _category("EMA Alignment", 10, [setup_checks[1]], []),
        _category("RSI Momentum", 10, [setup_checks[2]], []),
        _category("15M Pullback", 10, [setup_checks[3]], []),
        _category("Reversal Confirmation", 10, [setup_checks[4]], []),
        _category("Volume Confirmation", 10, [setup_checks[5]], []),
        _category("PDH/PDL Confirmation", 10, [setup_checks[6]], []),
        _category("5M Confirmation", 5, confirm["checks"], []),
    ]

    earned = sum(cat["earned"] for cat in categories)
    available = sum(cat["available"] for cat in categories)
    score_pct = round(earned / available * 100, 1) if available else 0.0

    verdict = _classify_ng(score_pct, params) if trend_matches else "NO_TRADE"

    price = confirm["price"]
    atr = confirm["atr"] or 0.0
    sl_distance = round(params.atr_multiplier * atr, 4)
    if direction == "BUY":
        stop_loss = round(price - sl_distance, 2)
        target_1 = round(price + sl_distance, 2)
        target_2 = round(price + 2 * sl_distance, 2)
    else:
        stop_loss = round(price + sl_distance, 2)
        target_1 = round(price - sl_distance, 2)
        target_2 = round(price - 2 * sl_distance, 2)
    risk_reward = round(abs(target_1 - price) / sl_distance, 2) if sl_distance else None

    risk_amount = round(capital * (account_risk_pct / 100), 2)
    position_size = int(risk_amount / sl_distance) if sl_distance else 0

    return {
        "contract": contract.upper(),
        "direction": direction,
        "trend": trend,
        "trend_matches_direction": trend_matches,
        "price": price,
        "score_pct": score_pct,
        "verdict": verdict,
        "signal_label": {
            "STRONG": f"STRONG {'BUY' if direction == 'BUY' else 'SELL'}",
            "TRADE": direction,
            "WATCH": "WATCH",
            "NO_TRADE": "NO TRADE",
        }[verdict],
        "points_earned": round(earned, 2),
        "points_available": round(available, 2),
        "categories": categories,
        "prev_day": {"high": pdh, "low": pdl, "close": pdc} if pd_levels else None,
        "entry": {
            "as_of": datetime.now(_IST).isoformat(),
            "entry_price": price,
            "stop_loss": stop_loss,
            "stop_loss_distance": sl_distance,
            "atr_multiplier": params.atr_multiplier,
            "target_1": target_1,
            "target_1_exit_pct": 50,
            "target_2": target_2,
            "target_2_exit_pct": 50,
            "risk_reward": risk_reward,
            "breakeven_after_target_1": True,
        },
        "position_sizing": {
            "capital": capital,
            "risk_pct": account_risk_pct,
            "risk_amount": risk_amount,
            "suggested_quantity": position_size,
        },
        "candles_used": {"1h": len(candles_1h), "15m": len(candles_15m), "5m": len(candles_5m)},
        "reasoning": build_ng_reasoning(
            categories, direction, trend, price, stop_loss, target_1, target_2,
            params.atr_multiplier,
        ),
    }


# ── Risk gate ─────────────────────────────────────────────────────────────


async def get_ng_risk_status(
    user_id: str,
    contract: str,
    repo: McxSignalRepository,
    cfg: SilverRiskConfig | None = None,
) -> dict:
    from app.services.mcx_service import get_zerodha_broker
    from app.services.mcx_service import resolve_contract as _resolve_contract

    cfg = cfg or SilverRiskConfig()
    signal_key = _SIGNAL_CONTRACT_KEY[contract.upper()]
    now = datetime.now(_IST)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0).replace(tzinfo=None)

    closed_today = await repo.list_user_closed_signals_since(user_id, signal_key, midnight)
    daily_state = compute_daily_state(closed_today)
    trade_check = check_can_trade(daily_state, cfg)
    session_blocked, session_note = is_within_session(now, cfg)

    broker = await get_zerodha_broker(user_id)
    contract_info = await _resolve_contract(broker, contract)
    expiry = contract_info["expiry"]
    expiry_blocked, expiry_note = is_expiry_protected(expiry, now, cfg)

    return {
        "contract": contract.upper(),
        "date": now.date().isoformat(),
        "trade_count": daily_state.trade_count,
        "max_trades_per_day": cfg.max_trades_per_day,
        "realized_pnl": daily_state.realized_pnl,
        "max_daily_loss_amount": round(cfg.capital * cfg.max_daily_loss_pct / 100, 2),
        "consecutive_losses": daily_state.consecutive_losses,
        "max_consecutive_losses": cfg.max_consecutive_losses,
        "can_trade": trade_check.can_trade,
        "blocked_reasons": trade_check.reasons,
        "within_session": session_blocked,
        "session_note": session_note,
        "expiry_protected": expiry_blocked,
        "expiry_note": expiry_note,
        "expiry_date": str(expiry),
    }


async def can_generate_new_signal(
    user_id: str, contract: str, repo: McxSignalRepository, cfg: SilverRiskConfig | None = None
) -> tuple[bool, list[str]]:
    status = await get_ng_risk_status(user_id, contract, repo, cfg)
    reasons = list(status["blocked_reasons"])
    if not status["within_session"]:
        reasons.append(status["session_note"])
    if status["expiry_protected"]:
        reasons.append(status["expiry_note"])
    return not reasons, reasons


# ── Signal generation / resolution ──────────────────────────────────────────


async def check_and_log_ng_signal(
    user_id: str, contract: str, direction: str, score: dict, repo: McxSignalRepository
) -> bool:
    if score["verdict"] not in ("TRADE", "STRONG"):
        return False
    signal_key = _SIGNAL_CONTRACT_KEY[contract.upper()]
    existing = await repo.get_open_signal(user_id, signal_key, direction)
    if existing is not None:
        return False

    entry = score["entry"]
    await repo.create_signal(
        user_id,
        signal_key,
        direction,
        {
            "tradingsymbol": contract.upper(),
            "score_pct": score["score_pct"],
            "verdict": score["verdict"],
            "entry_price": entry["entry_price"],
            "stop_loss": entry["stop_loss"],
            "target_1": entry["target_1"],
            "target_2": entry["target_2"],
            "target_1_hit": False,
            "generated_at": datetime.now(_IST).replace(tzinfo=None),
        },
    )
    return True


async def resolve_open_ng_signals(
    user_id: str, contract: str, repo: McxSignalRepository
) -> int:
    real_contract = contract.upper()
    signal_key = _SIGNAL_CONTRACT_KEY[real_contract]
    open_signals = await repo.list_open_signals(user_id, signal_key)
    if not open_signals:
        return 0

    quote = await _get_quote(user_id, real_contract)
    ltp = float(quote["last_price"])
    now = datetime.now(_IST).replace(tzinfo=None)
    changed = 0

    for sig in open_signals:
        direction = sig["direction"]
        entry = float(sig["entry_price"])
        stop_loss = float(sig["stop_loss"])
        target_1_hit = bool(sig.get("target_1_hit"))
        bull = direction == "BUY"
        age_days = round((now - sig["generated_at"]).total_seconds() / 86400, 2)

        if not target_1_hit:
            target_1 = float(sig["target_1"])
            hit_t1 = ltp >= target_1 if bull else ltp <= target_1
            hit_sl = ltp <= stop_loss if bull else ltp >= stop_loss
            if hit_t1:
                await repo.mark_target1_hit(sig["_id"], breakeven_stop=entry, target_1_hit_at=now)
                changed += 1
                continue
            if hit_sl:
                pnl = round((stop_loss - entry) * (1 if bull else -1), 2)
                await repo.close_signal(sig["_id"], "LOSS", stop_loss, pnl, now, age_days)
                changed += 1
                continue
        else:
            target_2 = float(sig["target_2"])
            hit_t2 = ltp >= target_2 if bull else ltp <= target_2
            hit_breakeven_stop = ltp <= stop_loss if bull else ltp >= stop_loss
            if hit_t2:
                pnl = round((target_2 - entry) * (1 if bull else -1), 2)
                await repo.close_signal(sig["_id"], "WIN", target_2, pnl, now, age_days)
                changed += 1
                continue
            if hit_breakeven_stop:
                await repo.close_signal(sig["_id"], "WIN", stop_loss, 0.0, now, age_days)
                changed += 1
                continue

        if age_days >= MTS_SIGNAL_EXPIRY_DAYS:
            pnl = round((ltp - entry) * (1 if bull else -1), 2)
            await repo.close_signal(sig["_id"], "EXPIRED", ltp, pnl, now, age_days)
            changed += 1

    return changed


def _serialize_ng_signal(doc: dict) -> dict:
    return {
        "direction": doc["direction"],
        "tradingsymbol": doc.get("tradingsymbol"),
        "score_pct": doc.get("score_pct"),
        "verdict": doc.get("verdict"),
        "generated_at": doc["generated_at"].isoformat(),
        "entry_price": doc["entry_price"],
        "stop_loss": doc["stop_loss"],
        "target_1": doc["target_1"],
        "target_2": doc.get("target_2"),
        "target_1_hit": bool(doc.get("target_1_hit")),
        "target_1_hit_at": (
            doc["target_1_hit_at"].isoformat() if doc.get("target_1_hit_at") else None
        ),
        "status": doc["status"],
        "result": doc.get("result"),
        "exit_price": doc.get("exit_price"),
        "pnl": doc.get("pnl"),
        "closed_at": doc["closed_at"].isoformat() if doc.get("closed_at") else None,
        "days_to_close": doc.get("days_to_close"),
    }


async def list_ng_signals_with_accuracy(
    user_id: str, contract: str, limit: int, repo: McxSignalRepository
) -> dict:
    signal_key = _SIGNAL_CONTRACT_KEY[contract.upper()]
    signals = await repo.list_signals(user_id, signal_key, limit)
    resolved = [s for s in signals if s.get("result") in ("WIN", "LOSS")]
    wins = sum(1 for s in resolved if s["result"] == "WIN")
    accuracy_pct = round(wins / len(resolved) * 100, 1) if resolved else None
    return {
        "contract": contract.upper(),
        "signals": [_serialize_ng_signal(s) for s in signals],
        "accuracy": {"resolved": len(resolved), "wins": wins, "accuracy_pct": accuracy_pct},
    }


# ── Backtest ──────────────────────────────────────────────────────────────


async def run_ng_strategy_backtest(
    user_id: str, contract: str, repo: McxSignalRepository, capital: float = 100_000.0
) -> dict:
    import dataclasses

    from app.domain.models.strategy_lab import TradeRecord
    from app.domain.services.strategy_lab.engine import BacktestOutcome
    from app.domain.services.strategy_lab.metrics import compute_metrics, drawdown_curve

    signal_key = _SIGNAL_CONTRACT_KEY[contract.upper()]
    signals = await repo.list_signals(user_id, signal_key, limit=2000)
    closed = [
        s for s in signals
        if s.get("status") == "CLOSED" and s.get("result") in ("WIN", "LOSS", "EXPIRED")
    ]
    closed.sort(key=lambda s: s["closed_at"])

    trades: list[TradeRecord] = []
    for s in closed:
        entry = float(s["entry_price"])
        exit_price = float(s["exit_price"])
        bull = s["direction"] == "BUY"
        qty = max(1, int(capital // entry)) if entry > 0 else 1
        pnl = round((exit_price - entry) * qty * (1 if bull else -1), 2)
        pnl_pct = (
            round((exit_price - entry) / entry * 100 * (1 if bull else -1), 2) if entry else 0.0
        )
        exit_reason = (
            "target" if s["result"] == "WIN"
            else "stop_loss" if s["result"] == "LOSS"
            else "eod"
        )
        trades.append(
            TradeRecord(
                entry_time=s["generated_at"], exit_time=s["closed_at"], signal=s["direction"],
                entry_price=entry, exit_price=exit_price, quantity=qty,
                pnl=pnl, pnl_pct=pnl_pct, exit_reason=exit_reason,
            )
        )

    if not trades:
        outcome = BacktestOutcome(trades=[], equity_curve=[], final_equity=capital)
        metrics = compute_metrics(outcome, capital)
        return {
            "contract": contract.upper(),
            "full_metrics": dataclasses.asdict(metrics),
            "equity_curve": [],
            "drawdown_curve": [],
            "trades": [],
            "total_trades": 0,
        }

    equity_curve = [{"time": trades[0].entry_time.isoformat(), "equity": capital}]
    running = capital
    for t in trades:
        running += t.pnl
        equity_curve.append({"time": t.exit_time.isoformat(), "equity": round(running, 2)})

    outcome = BacktestOutcome(trades=trades, equity_curve=equity_curve, final_equity=running)
    metrics = compute_metrics(outcome, capital)

    return {
        "contract": contract.upper(),
        "full_metrics": dataclasses.asdict(metrics),
        "equity_curve": equity_curve,
        "drawdown_curve": drawdown_curve(equity_curve),
        "trades": [dataclasses.asdict(t) for t in trades[-200:]],
        "total_trades": len(trades),
    }

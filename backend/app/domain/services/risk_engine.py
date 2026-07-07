"""Phase 2 Risk Engine — hard gate before every trade execution."""

from app.domain.models.risk import RiskCheckResult, RiskConfig


class RiskEngine:
    def __init__(self, config: RiskConfig | None = None) -> None:
        self._cfg = config or RiskConfig()

    @property
    def config(self) -> RiskConfig:
        return self._cfg

    def validate_trade(
        self,
        signal: str,
        entry: float,
        stop_loss: float,
        target: float,
        quantity: int,
    ) -> RiskCheckResult:
        violations: list[str] = []
        sig = signal.upper()

        # 1. Directional sanity
        if sig == "BUY":
            if stop_loss >= entry:
                violations.append(f"BUY stop_loss ₹{stop_loss} must be below entry ₹{entry}")
            if target <= entry:
                violations.append(f"BUY target ₹{target} must be above entry ₹{entry}")
        elif sig == "SELL":
            if stop_loss <= entry:
                violations.append(f"SELL stop_loss ₹{stop_loss} must be above entry ₹{entry}")
            if target >= entry:
                violations.append(f"SELL target ₹{target} must be below entry ₹{entry}")

        if violations:
            return RiskCheckResult(passed=False, violations=violations)

        risk = abs(entry - stop_loss)
        reward = abs(target - entry)

        # 2. Stop loss distance
        stop_pct = risk / entry * 100
        if stop_pct < 0.3:
            violations.append(f"Stop too tight ({stop_pct:.2f}%); minimum 0.3%")
        if stop_pct > self._cfg.max_stop_pct * 100:
            violations.append(
                f"Stop too wide ({stop_pct:.2f}%); maximum {self._cfg.max_stop_pct * 100:.0f}%"
            )

        # 3. Minimum R:R ratio
        if risk > 0:
            rr = reward / risk
            if rr < self._cfg.min_risk_reward:
                violations.append(f"R:R {rr:.2f} below minimum {self._cfg.min_risk_reward}")

        # 4. Position sizing
        max_position = self._cfg.capital * self._cfg.max_position_pct
        max_qty = max(1, int(max_position / entry))
        if entry * quantity > max_position:
            violations.append(
                f"Position ₹{entry * quantity:,.0f} exceeds "
                f"{self._cfg.max_position_pct * 100:.0f}% of capital "
                f"(max ₹{max_position:,.0f}); reduce qty to ≤{max_qty}"
            )
            return RiskCheckResult(passed=False, violations=violations, max_quantity=max_qty)

        return RiskCheckResult(passed=True, violations=[], max_quantity=max_qty)

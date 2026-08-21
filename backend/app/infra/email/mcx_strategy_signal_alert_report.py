"""HTML email for a new MTS Strategy (Gold/Silver/NG) signal -- sibling to
mcx_signal_alert_report.py, parameterized by strategy name and the combined
signal_label (BUY/STRONG BUY/SELL/STRONG SELL) each of the three MTS
Strategy engines already computes, instead of a plain direction. Sent
high-priority, same reasoning as mcx_signal_alert_report.py: an actionable,
time-sensitive call."""


def mcx_strategy_signal_alert_html(
    strategy_name: str,
    contract: str,
    tradingsymbol: str,
    signal_label: str,
    score_pct: float,
    entry_price: float,
    stop_loss: float,
    target_1: float,
    target_2: float | None,
) -> str:
    bull = "BUY" in signal_label
    accent = "#22c55e" if bull else "#ef4444"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,{accent},#18181b);padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro &middot; High Priority</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">{signal_label} — {strategy_name}</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{tradingsymbol} &middot; Score {score_pct:.1f}%</p>
  </div>
  <div style="padding:24px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <tbody>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 8px;color:#6b7280;">Entry Price</td>
          <td style="padding:10px 8px;font-family:monospace;font-weight:700;text-align:right;">₹{entry_price:,.2f}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 8px;color:#6b7280;">Stop Loss</td>
          <td style="padding:10px 8px;font-family:monospace;font-weight:700;color:#ef4444;text-align:right;">₹{stop_loss:,.2f}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 8px;color:#6b7280;">Target 1</td>
          <td style="padding:10px 8px;font-family:monospace;font-weight:700;color:#22c55e;text-align:right;">₹{target_1:,.2f}</td>
        </tr>
        {f'''<tr>
          <td style="padding:10px 8px;color:#6b7280;">Target 2</td>
          <td style="padding:10px 8px;font-family:monospace;font-weight:700;color:#22c55e;text-align:right;">₹{target_2:,.2f}</td>
        </tr>''' if target_2 is not None else ''}
      </tbody>
    </table>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Auto-logged whenever {strategy_name} reaches TRADE or STRONG tier for this contract/direction -- an
      AI-generated call, not investment advice. Risk controls (stop loss, position sizing) still apply as always.
      Review on the MTS Strategy Dashboard before acting.
    </p>
  </div>
</div>
</body>
</html>"""

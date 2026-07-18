"""HTML email for a new RSI-14 Reversion live signal (BUY/SELL) on Natural
Gas Mini -- sent as high-priority (see app/infra/email/client.py's priority
flag), since this is an actionable, time-sensitive call. Structurally mirrors
mcx_signal_alert_report.py (the NG-AI Pro score alert) but with copy specific
to this rule-based strategy -- deliberately NOT reused verbatim, since that
template's text ("AI Score", "NG-AI Pro score reaches TRADE tier") would be
inaccurate here."""


def rsi_signal_alert_html(
    tradingsymbol: str,
    direction: str,
    version: str,
    rsi: float | None,
    entry_price: float,
    stop_loss: float,
    target: float,
) -> str:
    bull = direction == "BUY"
    accent = "#22c55e" if bull else "#ef4444"
    rsi_label = f"{rsi:.1f}" if rsi is not None else "—"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,{accent},#18181b);padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro &middot; High Priority</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">{direction} Signal — RSI-14 Reversion ({version})</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{tradingsymbol} &middot; RSI-14 {rsi_label}</p>
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
        <tr>
          <td style="padding:10px 8px;color:#6b7280;">Target</td>
          <td style="padding:10px 8px;font-family:monospace;font-weight:700;color:#22c55e;text-align:right;">₹{target:,.2f}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Auto-logged whenever the RSI-14 Reversion strategy (oversold=20/overbought=80, SL 2.5%/target 5.0%/
      trailing stop 2.0%) opens a new position on Natural Gas Mini's 5-minute candles -- a rule-based,
      walk-forward-validated call (see the AI Strategy Lab), not investment advice. A trailing stop applies
      once the trade moves favorably; check the MCX page's RSI Strategy tab for the live level before acting.
    </p>
  </div>
</div>
</body>
</html>"""

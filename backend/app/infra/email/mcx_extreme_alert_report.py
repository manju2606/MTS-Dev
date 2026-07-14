"""HTML email for MCX day/week extreme-proximity alerts."""


def mcx_extreme_alert_html(
    contract: str, tradingsymbol: str, events: list[dict], threshold_pct: float
) -> str:
    rows = "".join(
        f"""
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 8px;font-weight:700;">{e["level_label"]}</td>
          <td style="padding:10px 8px;font-family:monospace;">{e["level_value"]:.2f}</td>
          <td style="padding:10px 8px;font-family:monospace;">{e["ltp"]:.2f}</td>
        </tr>"""
        for e in events
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#7c3aed,#4338ca);padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">Near Day/Week Extreme — {contract}</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{tradingsymbol}</p>
  </div>
  <div style="padding:24px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:2px solid #e5e7eb;">
        <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Level</th>
        <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Level Price</th>
        <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Current Price</th>
      </tr></thead>
      <tbody>{rows}</tbody>
    </table>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Within {threshold_pct}% of the level shown -- today's or this week's high/low, not a trade signal by itself.
      Not financial advice. Always verify with your own research.
    </p>
  </div>
</div>
</body>
</html>"""

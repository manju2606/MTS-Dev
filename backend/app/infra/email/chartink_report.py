"""HTML email report for a Chartink scan-alert webhook batch.

Multi-row table layout (mirrors dsws_report.py) rather than Golden Egg's
single-pick layout, since one Chartink webhook call can carry several
symbols at once.
"""

from __future__ import annotations

from app.domain.models.chartink_candidate import ChartinkCandidate


def _confidence_color(confidence: float) -> str:
    if confidence >= 0.7:
        return "#059669"
    if confidence >= 0.45:
        return "#f59e0b"
    return "#dc2626"


def _candidate_row(candidate: ChartinkCandidate) -> str:
    sym = candidate.symbol.replace(".NS", "").replace(".BO", "")
    color = _confidence_color(candidate.confidence)

    return f"""
  <tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:10px 8px;vertical-align:top;">
      <p style="margin:0;font-size:14px;font-weight:800;color:#111827;">{sym}</p>
      <p style="margin:2px 0 0;font-size:10px;color:#6b7280;">RSI {candidate.rsi:.0f} &middot; ADX {candidate.adx:.0f} &middot; Vol {candidate.volume_ratio:.1f}x</p>
    </td>
    <td style="padding:10px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:16px;font-weight:800;color:{color};">{candidate.confidence * 100:.0f}%</p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">Confidence</p>
    </td>
    <td style="padding:10px 8px;vertical-align:top;font-size:12px;">
      <table style="border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Entry</td>
          <td style="font-family:monospace;font-weight:700;color:#111827;">&#8377;{candidate.entry_price:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">SL</td>
          <td style="font-family:monospace;font-weight:700;color:#dc2626;">&#8377;{candidate.stop_loss:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Target</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{candidate.target:,.2f}</td>
        </tr>
      </table>
    </td>
    <td style="padding:10px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:14px;font-weight:800;color:#111827;">{candidate.risk_reward_ratio:.2f}</p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">R:R</p>
    </td>
  </tr>"""


def chartink_alert_html(
    scan_name: str, candidates: list[ChartinkCandidate], triggered_at: str
) -> str:
    rows = "".join(_candidate_row(c) for c in candidates)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Chartink — {scan_name}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">

<div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">\U0001f4c8 Chartink: {scan_name}</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Triggered {triggered_at} &nbsp;&middot;&nbsp; {len(candidates)} candidate(s)</p>
  </div>

  <!-- Candidates table -->
  <div style="padding:20px 32px 4px;">
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb;">
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Stock</th>
          <th style="padding:4px 8px;text-align:center;font-size:10px;color:#9ca3af;text-transform:uppercase;">Confidence</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Levels</th>
          <th style="padding:4px 8px;text-align:center;font-size:10px;color:#9ca3af;text-transform:uppercase;">R:R</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  </div>

  <!-- Disclaimer -->
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Not financial advice. Entry/Stop-Loss/Target are illustrative ATR-based sizing math for a manual
      decision, not a guarantee of any outcome. Confidence reflects this scan's own technical picture only
      -- always verify with your own research. Cash equities, NSE only.
    </p>
  </div>

</div>
</body>
</html>"""

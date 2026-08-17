"""HTML email report for Kotegawa Reversal picks. Mirrors btst_report.py's
shape/styling, adapted for a reversal (not breakout) strategy."""

from app.infra.scanner.kotegawa_scanner import KotegawaCandidate, KotegawaScan


def _pick_row(p: KotegawaCandidate) -> str:
    score_color = (
        "#059669"
        if p.confidence_score >= 70
        else "#f59e0b"
        if p.confidence_score >= 55
        else "#dc2626"
    )
    sym = p.symbol.replace(".NS", "").replace(".BO", "")

    reasons_html = "".join(
        f'<li style="margin:2px 0;font-size:11px;color:#374151;">{r}</li>' for r in p.reasons[:4]
    )

    return f"""
  <tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:12px 8px;vertical-align:top;width:28px;">
      <span style="display:inline-block;background:{score_color};color:#fff;font-size:11px;
        font-weight:700;border-radius:50%;width:22px;height:22px;line-height:22px;
        text-align:center;">
        {p.rank}
      </span>
    </td>
    <td style="padding:12px 8px;vertical-align:top;">
      <p style="margin:0;font-size:15px;font-weight:800;color:#111827;">{sym}</p>
      <p style="margin:2px 0 4px;font-size:11px;color:#6b7280;">
        {p.name} &nbsp;·&nbsp; {p.sector}
      </p>
      <p style="margin:0;font-size:11px;color:#dc2626;">
        {p.decline_1d_pct:+.1f}% today &nbsp;·&nbsp; {abs(p.kairi_pct):.1f}% below 25-day SMA
      </p>
    </td>
    <td style="padding:12px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:800;color:{score_color};">
        {p.confidence_score}
      </p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">Score</p>
    </td>
    <td style="padding:12px 8px;vertical-align:top;font-size:12px;">
      <table style="border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Entry</td>
          <td style="font-family:monospace;font-weight:700;">&#8377;{p.entry_price:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Stop</td>
          <td style="font-family:monospace;color:#dc2626;">&#8377;{p.stop_loss:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Target 1</td>
          <td style="font-family:monospace;color:#059669;">&#8377;{p.target_1:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">R:R</td>
          <td style="font-family:monospace;">1:{p.risk_reward:.2f}</td>
        </tr>
      </table>
      <ul style="margin:4px 0 0;padding-left:14px;">{reasons_html}</ul>
    </td>
  </tr>"""


def kotegawa_email_html(scan: KotegawaScan) -> str:
    rows = "".join(_pick_row(p) for p in scan.picks)
    scan_time_display = scan.scan_time[:16].replace("T", " ") if scan.scan_time else ""
    pick_count = len(scan.picks)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kotegawa Reversal — {scan.scan_date}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">

<div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:12px;
  overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#0f172a,#334155);padding:28px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;
      color:rgba(255,255,255,0.75);">
      Manju Trade AI Pro
    </p>
    <h1 style="margin:6px 0 0;font-size:24px;font-weight:800;color:#fff;">
      Kotegawa Reversal — Capitulation Bounce Picks
    </h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">
      Mean-reversion, BNF-style &nbsp;·&nbsp; {scan.scan_date} &nbsp;·&nbsp;
      {scan_time_display} IST
    </p>
  </div>

  <div style="background:#f1f5f9;border-bottom:1px solid #cbd5e1;padding:12px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="text-align:center;padding:0 16px 0 0;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#1e293b;">
            {scan.universe_scanned}
          </p>
          <p style="margin:0;font-size:10px;color:#475569;text-transform:uppercase;">Universe</p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #cbd5e1;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#1e293b;">
            {scan.passed_filter}
          </p>
          <p style="margin:0;font-size:10px;color:#475569;text-transform:uppercase;">
            Capitulation Candidates
          </p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #cbd5e1;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#059669;">{pick_count}</p>
          <p style="margin:0;font-size:10px;color:#475569;text-transform:uppercase;">Final Picks</p>
        </td>
      </tr>
    </table>
  </div>

  <table style="width:100%;border-collapse:collapse;">
    {rows}
  </table>

  <div style="padding:16px 32px;background:#f9fafb;">
    <p style="margin:0;font-size:10px;color:#9ca3af;">
      Modeled on Takashi Kotegawa's mean-reversion style: buy panic/high-volume
      capitulation declines, sell the bounce. This is not investment advice —
      verify every pick before trading.
    </p>
  </div>

</div>
</body>
</html>"""

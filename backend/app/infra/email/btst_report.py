"""HTML email report for BTST (Buy Today, Sell Tomorrow) picks."""

from app.infra.scanner.btst_scanner import BTSTCandidate, BTSTScan


def _pick_row(p: BTSTCandidate) -> str:
    score_color = (
        "#059669" if p.confidence_score >= 70
        else "#f59e0b" if p.confidence_score >= 50
        else "#dc2626"
    )
    sym = p.symbol.replace(".NS", "").replace(".BO", "")
    ltp_color = "#059669" if p.change_pct >= 0 else "#dc2626"

    reasons_html = "".join(
        f'<li style="margin:2px 0;font-size:11px;color:#374151;">{r}</li>'
        for r in p.reasons[:4]
    )

    badges = []
    if p.breakout_consolidation:
        badges.append('<span style="background:#ede9fe;color:#5b21b6;font-size:10px;padding:2px 5px;border-radius:3px;margin-right:3px;">Breakout</span>')
    if p.news_mentions > 0:
        badges.append('<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 5px;border-radius:3px;margin-right:3px;">News</span>')
    if p.fo_bullish:
        badges.append('<span style="background:#ecfdf5;color:#065f46;font-size:10px;padding:2px 5px;border-radius:3px;">F&amp;O Bullish</span>')

    return f"""
  <tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:12px 8px;vertical-align:top;width:28px;">
      <span style="display:inline-block;background:{score_color};color:#fff;font-size:11px;font-weight:700;border-radius:50%;width:22px;height:22px;line-height:22px;text-align:center;">
        {p.rank}
      </span>
    </td>
    <td style="padding:12px 8px;vertical-align:top;">
      <p style="margin:0;font-size:15px;font-weight:800;color:#111827;">{sym}</p>
      <p style="margin:2px 0 4px;font-size:11px;color:#6b7280;">{p.name} &nbsp;·&nbsp; {p.sector}</p>
      <div>{"".join(badges)}</div>
    </td>
    <td style="padding:12px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:800;color:{score_color};">{p.confidence_score}</p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">AI Score</p>
    </td>
    <td style="padding:12px 8px;vertical-align:top;font-size:12px;">
      <table style="border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">LTP</td>
          <td style="font-family:monospace;font-weight:700;color:{ltp_color};">
            &#8377;{p.current_price:,.2f} <span style="font-size:10px;">({'+' if p.change_pct >= 0 else ''}{p.change_pct:.2f}%)</span>
          </td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Entry</td>
          <td style="font-family:monospace;font-weight:700;color:#111827;">&#8377;{p.entry_price:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">SL</td>
          <td style="font-family:monospace;font-weight:700;color:#dc2626;">&#8377;{p.stop_loss:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Exit T1</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{p.target_1:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Exit T2</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{p.target_2:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">R:R</td>
          <td style="font-weight:700;color:#4f46e5;">{p.risk_reward:.2f}x</td>
        </tr>
      </table>
    </td>
    <td style="padding:12px 8px;vertical-align:top;font-size:11px;">
      <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;">
        RS(5D) {p.relative_strength_5d:+.1f}% &nbsp; Vol {p.volume_ratio:.1f}x
        {f" &nbsp; PCR {p.pcr:.2f}" if p.pcr is not None else ""}
      </p>
      <ul style="margin:4px 0 0;padding-left:14px;">{reasons_html}</ul>
    </td>
  </tr>"""


def btst_email_html(scan: BTSTScan) -> str:
    rows = "".join(_pick_row(p) for p in scan.picks)
    scan_time_display = scan.scan_time[:16].replace("T", " ") if scan.scan_time else ""
    pick_count = len(scan.picks)
    top_sym = scan.picks[0].symbol.replace(".NS", "") if scan.picks else "—"
    top_score = scan.picks[0].confidence_score if scan.picks else 0

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BTST — {scan.scan_date}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">

<div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:24px;font-weight:800;color:#fff;">BTST — Buy Today, Sell Tomorrow</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Overnight AI Picks &nbsp;·&nbsp; {scan.scan_date} &nbsp;·&nbsp; {scan_time_display} IST</p>
  </div>

  <!-- Summary strip -->
  <div style="background:#eef2ff;border-bottom:1px solid #c7d2fe;padding:12px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="text-align:center;padding:0 16px 0 0;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#3730a3;">{scan.universe_scanned}</p>
          <p style="margin:0;font-size:10px;color:#4338ca;text-transform:uppercase;">Universe</p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #c7d2fe;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#3730a3;">{scan.passed_filter}</p>
          <p style="margin:0;font-size:10px;color:#4338ca;text-transform:uppercase;">Pass 1 Filter</p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #c7d2fe;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#059669;">{pick_count}</p>
          <p style="margin:0;font-size:10px;color:#065f46;text-transform:uppercase;">BTST Picks</p>
        </td>
        <td style="text-align:center;padding:0 0 0 16px;border-left:1px solid #c7d2fe;">
          <p style="margin:0;font-size:16px;font-weight:800;color:#4f46e5;">{top_sym} · {top_score}</p>
          <p style="margin:0;font-size:10px;color:#4338ca;text-transform:uppercase;">Top Pick · Score</p>
        </td>
      </tr>
    </table>
  </div>

  <!-- Picks table -->
  <div style="padding:24px 32px;">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">
      Top {pick_count} BTST Candidates
    </h2>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb;">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">#</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Stock</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#9ca3af;text-transform:uppercase;">Score</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Levels</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Signals</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
  </div>

  <!-- Disclaimer -->
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      BTST picks are held overnight and sold the next trading session — this carries gap risk in both directions
      that no signal can fully eliminate. Algorithmic candidates only, not financial advice.
      Stop loss: 3%. Target: 5-8%. FII/DII cash-market flow is not available as a live data source and is
      therefore not included in scoring. For Indian markets (NSE) only.
    </p>
  </div>

</div>
</body>
</html>"""

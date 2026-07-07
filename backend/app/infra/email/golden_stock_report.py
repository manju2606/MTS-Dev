"""HTML email report for Golden Stock Intraday picks."""

from app.infra.scanner.golden_stock_scanner import GoldenStockScan, IntradayCandidate


def _score_bar(score: int, max_score: int, color: str) -> str:
    pct = min(100, int(score / max_score * 100)) if max_score > 0 else 0
    return (
        f'<div style="background:#e5e7eb;border-radius:4px;height:6px;width:80px;display:inline-block;vertical-align:middle;">'
        f'<div style="background:{color};height:6px;border-radius:4px;width:{pct}%;"></div>'
        f"</div>"
        f'<span style="font-size:11px;color:#6b7280;margin-left:4px;">{score}/{max_score}</span>'
    )


def _pick_row(p: IntradayCandidate) -> str:
    score_color = (
        "#059669"
        if p.confidence_score >= 70
        else "#f59e0b"
        if p.confidence_score >= 50
        else "#dc2626"
    )
    sym = p.symbol.replace(".NS", "").replace(".BO", "")
    reasons_html = "".join(
        f'<li style="margin:2px 0;font-size:11px;color:#374151;">{r}</li>' for r in p.reasons[:3]
    )
    badges = []
    if p.macd_bullish:
        badges.append(
            '<span style="background:#ede9fe;color:#5b21b6;font-size:10px;padding:2px 5px;border-radius:3px;margin-right:3px;">MACD</span>'
        )
    if p.near_day_high:
        badges.append(
            '<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 5px;border-radius:3px;margin-right:3px;">Near High</span>'
        )
    if p.above_sma50:
        badges.append(
            '<span style="background:#ecfdf5;color:#065f46;font-size:10px;padding:2px 5px;border-radius:3px;">SMA50+</span>'
        )

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
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">Score</p>
      <div style="margin-top:4px;">
        <div style="font-size:9px;color:#6b7280;margin-bottom:1px;">F {_score_bar(p.fundamental_score, 30, "#4f46e5")}</div>
        <div style="font-size:9px;color:#6b7280;margin-bottom:1px;">T {_score_bar(p.technical_score, 50, "#0891b2")}</div>
        <div style="font-size:9px;color:#6b7280;">M {_score_bar(p.momentum_score, 20, "#059669")}</div>
      </div>
    </td>
    <td style="padding:12px 8px;vertical-align:top;font-size:12px;">
      <table style="border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">LTP</td>
          <td style="font-family:monospace;font-weight:700;color:{"#059669" if p.change_pct >= 0 else "#dc2626"};">
            &#8377;{p.current_price:,.2f} <span style="font-size:10px;">({"+" if p.change_pct >= 0 else ""}{p.change_pct:.2f}%)</span>
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
          <td style="color:#6b7280;padding:1px 4px 1px 0;">T1</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{p.target_1:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">T2</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{p.target_2:,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">R:R</td>
          <td style="font-weight:700;color:#4f46e5;">{p.risk_reward:.2f}x</td>
        </tr>
      </table>
    </td>
    <td style="padding:12px 8px;vertical-align:top;font-size:11px;">
      <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;">RSI {p.rsi:.0f} &nbsp; ADX {p.adx:.0f} &nbsp; Vol {p.volume_ratio:.1f}x</p>
      <ul style="margin:4px 0 0;padding-left:14px;">{reasons_html}</ul>
    </td>
  </tr>"""


def golden_stock_email_html(scan: GoldenStockScan) -> str:
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
  <title>Golden Stock Intraday — {scan.scan_date}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">

<div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:28px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:24px;font-weight:800;color:#fff;">Golden Stock — Intraday</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Intraday AI Picks &nbsp;·&nbsp; {scan.scan_date} &nbsp;·&nbsp; {scan_time_display} IST</p>
  </div>

  <!-- Summary strip -->
  <div style="background:#fffbeb;border-bottom:1px solid #fde68a;padding:12px 32px;display:flex;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="text-align:center;padding:0 16px 0 0;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#92400e;">{scan.universe_scanned}</p>
          <p style="margin:0;font-size:10px;color:#b45309;text-transform:uppercase;">Universe</p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #fde68a;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#92400e;">{scan.passed_filter}</p>
          <p style="margin:0;font-size:10px;color:#b45309;text-transform:uppercase;">Pass 1 Filter</p>
        </td>
        <td style="text-align:center;padding:0 16px;border-left:1px solid #fde68a;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#059669;">{pick_count}</p>
          <p style="margin:0;font-size:10px;color:#065f46;text-transform:uppercase;">Intraday Picks</p>
        </td>
        <td style="text-align:center;padding:0 0 0 16px;border-left:1px solid #fde68a;">
          <p style="margin:0;font-size:16px;font-weight:800;color:#4f46e5;">{top_sym} · {top_score}</p>
          <p style="margin:0;font-size:10px;color:#4338ca;text-transform:uppercase;">Top Pick · Score</p>
        </td>
      </tr>
    </table>
  </div>

  <!-- Picks table -->
  <div style="padding:24px 32px;">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">
      Top {pick_count} Intraday Candidates
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
      Intraday picks are algorithmic candidates only. Not financial advice. Always verify with your own research.
      Entry and exit within the same trading session. Stop loss: 2.5%. Target: 5%.
      For Indian markets (NSE) only.
    </p>
  </div>

</div>
</body>
</html>"""

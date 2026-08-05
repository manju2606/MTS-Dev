"""HTML email report for the Golden Egg daily pick (see
app/services/golden_egg_service.py)."""

from app.infra.scanner.golden_stock_scanner import IntradayCandidate

_DISCLAIMER = """
    <p style="margin:0 0 6px;font-size:10px;color:#9ca3af;line-height:1.6;">
      This is an algorithmic candidate from a technical/fundamental screen, not financial
      advice and not a guarantee of any outcome -- intraday trading carries real risk of
      loss, including losing more than the stop-loss if the stock gaps through it.
    </p>
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Quantity and profit/loss figures are illustrative sizing math only -- size any
      position to your own capital and risk tolerance before acting. Cash equity (NSE)
      only; no options are considered. Always do your own verification before trading.
    </p>"""


def _market_context_html(market_context: str | None) -> str:
    if not market_context:
        return ""
    return f"""
  <div style="background:#eff6ff;border-bottom:1px solid #bfdbfe;padding:10px 32px;">
    <p style="margin:0;font-size:12px;color:#1e40af;">
      <strong>Market context this week:</strong> {market_context}
    </p>
  </div>"""


def golden_egg_pick_html(
    pick: IntradayCandidate, sizing: dict, target_profit: float, market_context: str | None
) -> str:
    sym = pick.symbol.replace(".NS", "").replace(".BO", "")
    score_color = (
        "#059669"
        if pick.confidence_score >= 70
        else "#f59e0b"
        if pick.confidence_score >= 50
        else "#dc2626"
    )
    reasons_html = "".join(
        f'<li style="margin:3px 0;font-size:12px;color:#374151;">{r}</li>' for r in pick.reasons
    )
    capped_note = (
        '<p style="margin:6px 0 0;font-size:11px;color:#b45309;">'
        "Quantity capped to stay within your configured paper capital -- the exact "
        "target profit may land a little under the headline figure above.</p>"
        if sizing.get("capped")
        else ""
    )
    qty = sizing.get("qty", 0)
    no_qty_note = (
        '<p style="margin:0;font-size:12px;color:#b45309;">Target level is at/below entry '
        "for today's ATR band -- no clean sizing available, review the levels manually.</p>"
        if qty <= 0
        else ""
    )

    sizing_block = (
        f"""
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px;">
      <tr><td style="padding:5px 0;color:#6b7280;">Suggested Quantity</td>
          <td style="padding:5px 0;font-weight:700;color:#111827;text-align:right;">{qty} shares</td></tr>
      <tr><td style="padding:5px 0;color:#6b7280;">Position Value</td>
          <td style="padding:5px 0;font-family:monospace;text-align:right;">₹{sizing['position_value']:,.0f}</td></tr>
      <tr><td style="padding:5px 0;color:#6b7280;">Expected Profit @ Target 1</td>
          <td style="padding:5px 0;font-family:monospace;font-weight:700;color:#059669;text-align:right;">₹{sizing['expected_profit']:,.0f}</td></tr>
      <tr><td style="padding:5px 0;color:#6b7280;">Max Loss @ Stop Loss</td>
          <td style="padding:5px 0;font-family:monospace;font-weight:700;color:#dc2626;text-align:right;">₹{sizing['max_loss']:,.0f}</td></tr>
    </table>
    {capped_note}"""
        if qty > 0
        else no_qty_note
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Egg — {sym}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:26px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">\U0001f95a Golden Egg — Today's Pick</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Target ~₹{target_profit:,.0f} · Intraday · Cash Equity Only</p>
  </div>
  {_market_context_html(market_context)}

  <div style="padding:26px 32px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
      <div>
        <p style="margin:0;font-size:24px;font-weight:800;color:#111827;">{sym}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">{pick.name} &nbsp;·&nbsp; {pick.sector}</p>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:28px;font-weight:800;color:{score_color};">{pick.confidence_score}</p>
        <p style="margin:0;font-size:10px;text-transform:uppercase;color:#9ca3af;">Confidence Score</p>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;">LTP</td>
          <td style="padding:6px 0;font-family:monospace;text-align:right;">₹{pick.current_price:,.2f} ({"+" if pick.change_pct >= 0 else ""}{pick.change_pct:.2f}%)</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Entry</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#111827;text-align:right;">₹{pick.entry_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Stop Loss</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#dc2626;text-align:right;">₹{pick.stop_loss:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Target 1</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#059669;text-align:right;">₹{pick.target_1:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Target 2 (stretch)</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#059669;text-align:right;">₹{pick.target_2:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Risk:Reward</td>
          <td style="padding:6px 0;font-weight:700;color:#4f46e5;text-align:right;">{pick.risk_reward:.2f}x</td></tr>
    </table>

    <div style="margin-top:14px;padding:14px;background:#f9fafb;border-radius:8px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;color:#9ca3af;">Suggested Sizing (for ~₹{target_profit:,.0f} target)</p>
      {sizing_block}
    </div>

    <div style="margin-top:14px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;color:#9ca3af;">Why this stock</p>
      <ul style="margin:0;padding-left:18px;">{reasons_html}</ul>
    </div>

    <div style="margin-top:14px;padding:14px;background:#eff6ff;border-radius:8px;border-left:4px solid #2563eb;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;color:#1e40af;">How to trade this (idea, not instructions)</p>
      <ol style="margin:0;padding-left:18px;font-size:12px;color:#1e3a8a;line-height:1.7;">
        <li>Buy in the cash segment at or near ₹{pick.entry_price:,.2f} -- avoid chasing if the price has already run well past entry.</li>
        <li>Place your stop-loss order immediately at ₹{pick.stop_loss:,.2f} -- decide this before entry, not after.</li>
        <li>Book at Target 1 (₹{pick.target_1:,.2f}); optionally trail part of the position toward Target 2 (₹{pick.target_2:,.2f}) if momentum holds.</li>
        <li>Exit by market close regardless -- this is a same-session (intraday) idea, not a multi-day hold.</li>
      </ol>
    </div>
  </div>

  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    {_DISCLAIMER}
  </div>
</div>
</body></html>"""


def golden_egg_no_pick_html(scan_date: str, market_context: str | None) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:26px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">\U0001f95a Golden Egg — {scan_date}</h1>
  </div>
  {_market_context_html(market_context)}
  <div style="padding:26px 32px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
      No candidate cleared today's intraday screen (confidence, volume, and
      proximity-to-day-high filters) as of market open. Forcing a pick on a day
      with no clean setup would do you a disservice -- better to sit this one out
      than trade a weak idea. Check back tomorrow.
    </p>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    {_DISCLAIMER}
  </div>
</div>
</body></html>"""

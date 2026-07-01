"""Daily stock research report — builds and sends an HTML email with today's top picks."""

from datetime import date, datetime, timezone, timedelta

import structlog

log = structlog.get_logger()

_SIGNAL_COLOR = {
    "STRONG_BUY":  ("#065f46", "#d1fae5"),  # dark-green text, light-green bg
    "BUY":         ("#065f46", "#ecfdf5"),
    "WATCH":       ("#78350f", "#fef3c7"),
    "NEUTRAL":     ("#374151", "#f3f4f6"),
    "SELL":        ("#991b1b", "#fee2e2"),
    "STRONG_SELL": ("#7f1d1d", "#fee2e2"),
}


def _rr_color(rr: float) -> str:
    if rr >= 2.5:
        return "#065f46"
    if rr >= 1.5:
        return "#b45309"
    return "#991b1b"


def _score_bar(score: float) -> str:
    """Inline HTML progress bar for a 0–100 score."""
    fill = "#4f46e5" if score >= 70 else "#f59e0b" if score >= 50 else "#ef4444"
    return (
        f'<div style="background:#e5e7eb;border-radius:4px;height:6px;width:80px;display:inline-block;vertical-align:middle;">'
        f'<div style="background:{fill};height:6px;border-radius:4px;width:{score:.0f}%;"></div></div>'
        f'&nbsp;<span style="font-size:11px;color:#374151;vertical-align:middle;">{score:.0f}</span>'
    )


def _pct(entry: float, target: float) -> str:
    if entry == 0:
        return ""
    pct = (target - entry) / entry * 100
    sign = "+" if pct >= 0 else ""
    return f'<span style="font-size:10px;color:#6b7280;display:block;">{sign}{pct:.1f}%</span>'


def _stock_row(idx: int, s: object) -> str:  # s: StockScore
    sig_fg, sig_bg = _SIGNAL_COLOR.get(getattr(s, "signal", ""), ("#374151", "#f3f4f6"))
    rr = getattr(s, "risk_reward_ratio", 0.0)
    targets = getattr(s, "targets", [])
    entry = getattr(s, "entry_price", 0)
    stop = getattr(s, "stop_loss", 0)
    t1_val = targets[0] if len(targets) > 0 else None
    t2_val = targets[1] if len(targets) > 1 else None
    t3_val = targets[2] if len(targets) > 2 else None

    def _tgt_cell(val: float | None, color: str) -> str:
        if val is None:
            return '<td style="padding:8px 6px;font-size:12px;color:#6b7280;">—</td>'
        return (
            f'<td style="padding:8px 6px;font-family:monospace;font-size:12px;color:{color};">'
            f'&#8377;{val:.2f}{_pct(entry, val)}</td>'
        )

    stop_pct = _pct(entry, stop) if entry else ""
    patterns_raw = getattr(s, "patterns", [])
    patterns_html = "".join(
        f'<span style="display:inline-block;background:#ede9fe;color:#5b21b6;border-radius:3px;padding:1px 5px;font-size:10px;margin:1px;">{p}</span>'
        for p in patterns_raw[:3]
    )
    row_bg = "#f9fafb" if idx % 2 == 0 else "#ffffff"
    sym = getattr(s, "symbol", "").replace(".NS", "").replace(".BO", "")
    return (
        f'<tr style="background:{row_bg};">'
        f'<td style="padding:8px 6px;color:#6b7280;font-size:12px;text-align:center;">{idx}</td>'
        f'<td style="padding:8px 6px;">'
        f'  <div style="font-weight:700;font-size:13px;color:#111827;">{sym}</div>'
        f'  <div style="font-size:11px;color:#6b7280;">{getattr(s, "name", "")}</div>'
        f'  <div style="margin-top:3px;">{patterns_html}</div>'
        f'</td>'
        f'<td style="padding:8px 6px;text-align:center;">'
        f'  <span style="display:inline-block;background:{sig_bg};color:{sig_fg};border-radius:12px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">{getattr(s, "signal", "")}</span>'
        f'</td>'
        f'<td style="padding:8px 6px;">{_score_bar(getattr(s, "score", 0.0))}</td>'
        f'<td style="padding:8px 6px;font-family:monospace;font-size:12px;color:#111827;">&#8377;{entry:.2f}</td>'
        f'<td style="padding:8px 6px;font-family:monospace;font-size:12px;color:#dc2626;">&#8377;{stop:.2f}{stop_pct}</td>'
        + _tgt_cell(t1_val, "#059669")
        + _tgt_cell(t2_val, "#047857")
        + _tgt_cell(t3_val, "#065f46")
        + f'<td style="padding:8px 6px;font-weight:700;font-size:12px;color:{_rr_color(rr)}">{rr:.2f}</td>'
        f'<td style="padding:8px 6px;font-size:11px;color:#6b7280;">{getattr(s, "holding_period", "")}</td>'
        f'</tr>'
    )


def _signal_counts(picks: list) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in picks:
        sig = getattr(p, "signal", "NEUTRAL")
        counts[sig] = counts.get(sig, 0) + 1
    return counts


def build_report_html(picks: list, scanned_count: int) -> str:
    IST = timezone(timedelta(hours=5, minutes=30))
    now_ist_dt = datetime.now(IST)
    today = now_ist_dt.strftime("%A, %d %B %Y")
    now_ist = now_ist_dt.strftime("%I:%M %p IST")

    counts = _signal_counts(picks)
    strong_buy = counts.get("STRONG_BUY", 0)
    buy = counts.get("BUY", 0)
    watch = counts.get("WATCH", 0)

    if not picks:
        body_html = """
        <div style="text-align:center;padding:40px;color:#6b7280;">
          <p style="font-size:16px;">No strong picks found in today's scan.</p>
          <p>Markets may be in a consolidation phase. Check again tomorrow.</p>
        </div>"""
    else:
        rows = "".join(_stock_row(i + 1, s) for i, s in enumerate(picks))
        body_html = f"""
        <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 16px;">
          Today's Tradable Picks
        </h2>
        <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;">
          <thead>
            <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 8px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;">#</th>
              <th style="padding:10px 8px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Symbol</th>
              <th style="padding:10px 8px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;">Signal</th>
              <th style="padding:10px 8px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Score</th>
              <th style="padding:8px 6px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Entry ₹</th>
              <th style="padding:8px 6px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Stop ₹</th>
              <th style="padding:8px 6px;font-size:11px;color:#059669;text-align:left;font-weight:600;">T1 ₹</th>
              <th style="padding:8px 6px;font-size:11px;color:#047857;text-align:left;font-weight:600;">T2 ₹</th>
              <th style="padding:8px 6px;font-size:11px;color:#065f46;text-align:left;font-weight:600;">T3 ₹</th>
              <th style="padding:8px 6px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">R:R</th>
              <th style="padding:8px 6px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Hold</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        </div>
        <p style="font-size:11px;color:#9ca3af;margin-top:12px;">
          * T1/T2/T3 = Progressive targets. % shown below each price = gain from entry. R:R = Risk-Reward to T1. Score = composite AI score (0–100).
        </p>"""

    summary_pills = []
    if strong_buy:
        summary_pills.append(
            f'<span style="background:#d1fae5;color:#065f46;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;margin-right:6px;">'
            f'⬆ {strong_buy} STRONG BUY</span>'
        )
    if buy:
        summary_pills.append(
            f'<span style="background:#ecfdf5;color:#065f46;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;margin-right:6px;">'
            f'↑ {buy} BUY</span>'
        )
    if watch:
        summary_pills.append(
            f'<span style="background:#fef3c7;color:#78350f;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;margin-right:6px;">'
            f'◉ {watch} WATCH</span>'
        )
    pills_html = " ".join(summary_pills) if summary_pills else '<span style="color:#6b7280;">No actionable picks today</span>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:28px 32px;">
    <div style="color:white;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.75;margin-bottom:4px;">
        Manju Trade AI Pro
      </div>
      <h1 style="margin:0;font-size:22px;font-weight:700;">Daily Research Report</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">{today} &nbsp;·&nbsp; Generated at {now_ist}</p>
    </div>
  </div>

  <!-- Summary bar -->
  <div style="background:#fafafa;border-bottom:1px solid #e5e7eb;padding:16px 32px;">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
      <span style="font-size:13px;color:#374151;margin-right:12px;">
        📊 <strong>{scanned_count}</strong> stocks scanned
      </span>
      {pills_html}
    </div>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px;">
    {body_html}
  </div>

  <!-- Score legend -->
  <div style="margin:0 32px 24px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;padding:16px;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#374151;">Score Breakdown</p>
    <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:11px;color:#6b7280;">
      <span>🔵 Technical (40%) — RSI, MACD, volume, Bollinger Bands</span>
      <span>🟡 News (30%) — sentiment from 20+ Indian financial sources</span>
      <span>🟣 ML Model (20%) — price prediction signal</span>
      <span>⚪ Social (10%) — stub (X, Reddit, YouTube)</span>
    </div>
  </div>

  <!-- CTA -->
  <div style="padding:0 32px 28px;text-align:center;">
    <a href="http://localhost:3000/discovery"
       style="display:inline-block;background:#4f46e5;color:white;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;text-decoration:none;">
      Open Discovery Dashboard →
    </a>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">
    <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
      ⚠ This report is auto-generated for informational purposes only. It does not constitute investment advice.
      Past performance and AI signals do not guarantee future results. Always apply your own risk management
      before placing any trade. Never risk more than you can afford to lose.
    </p>
    <p style="margin:8px 0 0;font-size:10px;color:#d1d5db;">
      Manju Trade AI Pro · Indian Markets (NSE/BSE) · Automated hourly 08:15–15:15 IST, Mon–Fri
    </p>
  </div>

</div>
</body>
</html>"""


async def send_daily_report() -> None:
    """Fetch today's top picks from MongoDB and email the report to all active recipients."""
    from app.core.config import settings
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    from app.infra.email.client import send_email

    # Build recipient list: managed email list + fallback to env var
    email_repo = EmailListRepository()
    managed = await email_repo.list_active_emails()
    fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
    recipients: list[str] = managed if managed else ([fallback] if fallback else [])

    if not recipients:
        log.warning("daily_report.no_recipient", hint="Add emails via Admin > Email List")
        return

    try:
        repo = DiscoveryRepository()
        picks = await repo.get_top_picks(limit=20, min_score=50)
        scanned = await repo.count_latest_scan()

        subject = f"📈 Daily Picks — {date.today().strftime('%d %b %Y')} | {len(picks)} actionable stocks"
        html = build_report_html(picks, scanned)

        for to in recipients:
            await send_email(to=to, subject=subject, html=html)

        await repo.save_report(picks, scanned)
        safe = subject.encode("ascii", errors="replace").decode("ascii")
        log.info("daily_report.sent", to=recipients, picks=len(picks), subject=safe)
    except Exception as exc:
        log.error("daily_report.error", error=str(exc))

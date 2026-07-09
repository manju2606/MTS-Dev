"""HTML email report for DSWS (Daily Discovery Watchlist Summary)."""

BUCKET_META = {
    "STRONG_BUY": {"label": "Strong Buy", "color": "#059669", "bg": "#ecfdf5"},
    "BUY": {"label": "Buy", "color": "#0891b2", "bg": "#ecfeff"},
    "SELL": {"label": "Sell", "color": "#dc2626", "bg": "#fef2f2"},
    "STRONG_SELL": {"label": "Strong Sell", "color": "#991b1b", "bg": "#fef2f2"},
}


def _pick_row(pick: dict, color: str) -> str:
    sym = pick["symbol"].replace(".NS", "").replace(".BO", "")
    checkpoints = pick.get("checkpoints") or []
    pct = pick.get("close_pct")
    if pct is None:
        pct = checkpoints[-1]["pct_change"] if checkpoints else None
    pct_display = f"{'+' if pct >= 0 else ''}{pct:.2f}%" if pct is not None else "—"
    pct_color = "#059669" if (pct or 0) >= 0 else "#dc2626"

    return f"""
  <tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:10px 8px;vertical-align:top;">
      <p style="margin:0;font-size:14px;font-weight:800;color:#111827;">{sym}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">{pick.get("name", sym)}</p>
    </td>
    <td style="padding:10px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:16px;font-weight:800;color:{color};">{pick.get("score", 0):.0f}</p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">Score</p>
    </td>
    <td style="padding:10px 8px;vertical-align:top;font-size:12px;">
      <table style="border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Entry</td>
          <td style="font-family:monospace;font-weight:700;color:#111827;">&#8377;{pick.get("entry_price", 0):,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">SL</td>
          <td style="font-family:monospace;font-weight:700;color:#dc2626;">&#8377;{pick.get("stop_loss", 0):,.2f}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:1px 4px 1px 0;">Target</td>
          <td style="font-family:monospace;font-weight:700;color:#059669;">&#8377;{pick.get("target", 0):,.2f}</td>
        </tr>
      </table>
    </td>
    <td style="padding:10px 8px;vertical-align:top;text-align:center;">
      <p style="margin:0;font-size:14px;font-weight:800;color:{pct_color};">{pct_display}</p>
      <p style="margin:0;font-size:9px;color:#9ca3af;text-transform:uppercase;">since entry</p>
    </td>
  </tr>"""


def _bucket_section(bucket: str, picks: list[dict]) -> str:
    if not picks:
        return ""
    meta = BUCKET_META[bucket]
    rows = "".join(_pick_row(p, meta["color"]) for p in picks)
    return f"""
  <div style="padding:20px 32px 4px;">
    <h2 style="margin:0 0 12px;font-size:13px;font-weight:800;color:{meta["color"]};text-transform:uppercase;letter-spacing:0.5px;background:{meta["bg"]};display:inline-block;padding:4px 10px;border-radius:4px;">
      {meta["label"]} &nbsp;&middot;&nbsp; {len(picks)}
    </h2>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb;">
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Stock</th>
          <th style="padding:4px 8px;text-align:center;font-size:10px;color:#9ca3af;text-transform:uppercase;">Score</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;">Levels</th>
          <th style="padding:4px 8px;text-align:center;font-size:10px;color:#9ca3af;text-transform:uppercase;">Change</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  </div>"""


def dsws_email_html(doc: dict) -> str:
    scan_date = doc.get("scan_date", "")
    buckets = doc.get("buckets", {})
    total = sum(len(buckets.get(b, [])) for b in BUCKET_META)
    generated_at = (doc.get("updated_at") or doc.get("generated_at") or "")[:16].replace("T", " ")

    sections = "".join(_bucket_section(b, buckets.get(b, [])) for b in BUCKET_META)
    counts_strip = "".join(
        f"""
        <td style="text-align:center;padding:0 14px;{"border-left:1px solid #e5e7eb;" if i else ""}">
          <p style="margin:0;font-size:18px;font-weight:800;color:{BUCKET_META[b]["color"]};">{len(buckets.get(b, []))}</p>
          <p style="margin:0;font-size:9px;color:#6b7280;text-transform:uppercase;">{BUCKET_META[b]["label"]}</p>
        </td>"""
        for i, b in enumerate(BUCKET_META)
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DSWS — {scan_date}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">

<div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4f46e5,#4338ca);padding:28px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:24px;font-weight:800;color:#fff;">DSWS — Daily Discovery Watchlist</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{scan_date} &nbsp;&middot;&nbsp; updated {generated_at} IST &nbsp;&middot;&nbsp; {total} stocks tracked</p>
  </div>

  <!-- Summary strip -->
  <div style="background:#f5f5ff;border-bottom:1px solid #e0e0fa;padding:12px 32px;">
    <table style="width:100%;border-collapse:collapse;"><tr>{counts_strip}</tr></table>
  </div>

  {sections}

  <!-- Disclaimer -->
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      Algorithmic watchlist picks only. Not financial advice. Always verify with your own research.
      For Indian markets (NSE) only.
    </p>
  </div>

</div>
</body>
</html>"""

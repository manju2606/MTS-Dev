"""HTML email for the daily Zerodha token-expiry reminder."""


def zerodha_token_reminder_html() -> str:
    reconnect_url = "http://localhost/broker"
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.75);">Manju Trade AI Pro</p>
    <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">Zerodha Reconnect Needed</h1>
  </div>
  <div style="padding:24px 32px;">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
      Zerodha invalidates yesterday's access token every day, so today's session
      needs a fresh login before MCX quotes, predictions, and trade signals can run.
    </p>
    <a href="{reconnect_url}" style="display:inline-block;background:#0891b2;color:#fff;
      text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">
      Reconnect Zerodha &rarr;
    </a>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.6;">
      You're receiving this because your Zerodha session on Manju Trade AI Pro
      needs daily reauthorization. This app never stores your Zerodha password or TOTP secret.
    </p>
  </div>
</div>
</body>
</html>"""

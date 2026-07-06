"""Quick email test — run from the backend/ directory.

Dry run (preview HTML in browser, no credentials needed):
    python scripts/test_email.py

Live send (requires SMTP_USER + SMTP_PASSWORD in backend/.env):
    python scripts/test_email.py --send

Send to a specific address:
    python scripts/test_email.py --send --to someone@example.com
"""

import argparse
import asyncio
import sys
import uuid
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path

# Make sure the app package is importable when running from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))


def _fake_picks():
    """Return a handful of realistic-looking StockScore objects for the preview."""
    from app.domain.models.discovery import StockScore

    data = [
        ("RELIANCE.NS", "Reliance Industries", 81.5, "STRONG_BUY", 2448.0, 2375.0, [2540.0, 2640.0, 2750.0], 2.35, "3–5 days",
         82.0, 79.0, 76.0, 50.0, ["MACD bullish crossover", "Volume surge 2.3×", "SMA-20 > SMA-50 uptrend"]),
        ("INFY.NS",     "Infosys",              76.2, "STRONG_BUY", 1812.0, 1755.0, [1880.0, 1950.0, 2020.0], 1.96, "5–7 days",
         74.0, 80.0, 71.0, 50.0, ["RSI recovering from oversold", "Bullish news sentiment", "BB lower bounce"]),
        ("HDFCBANK.NS", "HDFC Bank",            68.8, "BUY",        1624.0, 1575.0, [1680.0, 1740.0, 1800.0], 1.63, "3–5 days",
         70.0, 65.0, 73.0, 50.0, ["Full bullish alignment (5 MAs)", "Volume confirmation"]),
        ("TCS.NS",      "Tata Consultancy",     65.1, "BUY",        3910.0, 3790.0, [4050.0, 4200.0, 4350.0], 1.67, "5–7 days",
         66.0, 62.0, 68.0, 50.0, ["MACD signal crossover", "RSI momentum"]),
        ("WIPRO.NS",    "Wipro",                58.4, "WATCH",      480.5,  462.0,  [500.0,  518.0,  535.0],  1.43, "2–3 days",
         60.0, 55.0, 58.0, 50.0, ["BB squeeze — potential breakout", "Volume building"]),
        ("BAJFINANCE.NS","Bajaj Finance",        55.7, "WATCH",      7180.0, 6950.0, [7420.0, 7650.0, 7880.0], 1.48, "5–7 days",
         58.0, 52.0, 57.0, 50.0, ["RSI at 45 — approaching buy zone"]),
    ]

    picks = []
    for i, row in enumerate(data):
        sym, name, score, signal, entry, stop, targets, rr, hold, tech, news, ml, social, patterns = row
        picks.append(StockScore(
            id=uuid.uuid4(),
            symbol=sym,
            name=name,
            score=score,
            signal=signal,
            confidence=score / 100,
            entry_price=entry,
            stop_loss=stop,
            targets=targets,
            holding_period=hold,
            risk_reward_ratio=rr,
            technical_score=tech,
            news_score=news,
            ml_score=ml,
            social_score=social,
            patterns=patterns,
            news_summary="",
            explanation=f"{signal}: Technical {tech:.0f}/100 · News {news:.0f}/100 · ML {ml:.0f}/100.",
            scanned_at=datetime.utcnow() - timedelta(minutes=i * 2),
        ))
    return picks


async def run(send: bool, to: str | None) -> None:
    from app.core.config import settings
    from app.infra.email.client import send_email
    from app.infra.email.report import build_report_html

    picks = _fake_picks()
    html = build_report_html(picks, scanned_count=158)

    # Always write preview file
    preview_path = Path(__file__).parent.parent / "scripts" / "email_preview.html"
    preview_path.write_text(html, encoding="utf-8")
    print(f"  HTML preview written -> {preview_path}")

    try:
        webbrowser.open(preview_path.as_uri())
        print("  Opened in browser.")
    except Exception:
        print(f"  Open manually: {preview_path}")

    if not send:
        print("\n  (Dry run — pass --send to actually deliver the email)")
        return

    recipient = to or settings.REPORT_TO_EMAIL or settings.SMTP_USER
    if not recipient:
        print("\n  ERROR: No recipient. Set REPORT_TO_EMAIL in backend/.env or pass --to addr@example.com")
        sys.exit(1)

    # Check credentials
    if not settings.SMTP_USER and not settings.RESEND_API_KEY:
        print("\n  ERROR: No sending credentials found in backend/.env")
        print("  Add either:")
        print("    SMTP_USER=your@gmail.com")
        print("    SMTP_PASSWORD=xxxx xxxx xxxx xxxx   # Gmail App Password")
        print("  or:")
        print("    RESEND_API_KEY=re_...")
        sys.exit(1)

    subject = "📈 [TEST] Manju Trade AI Pro — Daily Picks Email"
    print(f"\n  Sending test email to {recipient} …")
    await send_email(to=recipient, subject=subject, html=html)
    print("  Done. Check your inbox (and spam folder).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Test the daily email report")
    parser.add_argument("--send", action="store_true", help="Actually send the email")
    parser.add_argument("--to", metavar="EMAIL", help="Override recipient address")
    args = parser.parse_args()

    print("\nManju Trade AI Pro — Email Test")
    print("=" * 40)

    if args.send:
        print("  Mode: LIVE SEND")
    else:
        print("  Mode: DRY RUN (HTML preview only)")

    asyncio.run(run(send=args.send, to=args.to))


if __name__ == "__main__":
    main()

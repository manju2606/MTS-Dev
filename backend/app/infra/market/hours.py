"""Shared NSE/BSE market-hours check (9:15-15:30 IST, Monday-Friday)."""

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def is_market_open_ist(now: datetime | None = None) -> bool:
    now_ist = (now or datetime.now(IST)).astimezone(IST)
    if now_ist.weekday() >= 5:
        return False
    hm = now_ist.hour * 100 + now_ist.minute
    return 915 <= hm <= 1530

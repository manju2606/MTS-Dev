"""Stub interfaces for social media sentiment providers.

Each provider returns a SocialSignal with is_stub=True.  Replace the body of
each function with a real implementation once you have the corresponding API
credentials:

  Twitter/X  : Requires Twitter API v2 Bearer Token ($100+/month Basic tier)
  Reddit     : OAuth2 app at https://www.reddit.com/prefs/apps
  YouTube    : Google Cloud API key with YouTube Data API v3 enabled
  Telegram   : Bot token via @BotFather + Telethon or pyrogram
  Google Trends: Uses pytrends (free, but rate-limited)
"""

from datetime import datetime

import structlog

from app.domain.models.discovery import SocialSignal

log = structlog.get_logger()


async def fetch_twitter_sentiment(symbol: str) -> SocialSignal:
    log.debug("social.twitter.stub", symbol=symbol)
    return SocialSignal(source="twitter", symbol=symbol, score=0.0, mention_volume=0, is_stub=True)


async def fetch_reddit_sentiment(symbol: str) -> SocialSignal:
    log.debug("social.reddit.stub", symbol=symbol)
    return SocialSignal(source="reddit", symbol=symbol, score=0.0, mention_volume=0, is_stub=True)


async def fetch_youtube_sentiment(symbol: str) -> SocialSignal:
    log.debug("social.youtube.stub", symbol=symbol)
    return SocialSignal(source="youtube", symbol=symbol, score=0.0, mention_volume=0, is_stub=True)


async def fetch_telegram_sentiment(symbol: str) -> SocialSignal:
    log.debug("social.telegram.stub", symbol=symbol)
    return SocialSignal(source="telegram", symbol=symbol, score=0.0, mention_volume=0, is_stub=True)


async def fetch_google_trends(symbol: str) -> SocialSignal:
    """Fetch Google Trends interest for the symbol.

    Uncomment the pytrends block once you install: pip install pytrends
    Rate-limited by Google — keep calls infrequent (one per symbol per scan).
    """
    # from pytrends.request import TrendReq
    # try:
    #     pt = TrendReq(hl="en-IN", tz=330)
    #     keyword = symbol.replace(".NS", "").replace(".BO", "")
    #     pt.build_payload([keyword], cat=0, timeframe="now 7-d", geo="IN")
    #     df = pt.interest_over_time()
    #     if not df.empty:
    #         latest = float(df[keyword].iloc[-1])   # 0–100
    #         score = (latest - 50) / 50             # normalise to -1..+1
    #         return SocialSignal(source="google_trends", symbol=symbol,
    #                             score=score, mention_volume=int(latest), is_stub=False)
    # except Exception as e:
    #     log.warning("social.google_trends.error", symbol=symbol, error=str(e))
    return SocialSignal(source="google_trends", symbol=symbol, score=0.0, mention_volume=0, is_stub=True)


async def aggregate_social_score(symbol: str) -> tuple[float, bool]:
    """Return (social_score_0_to_100, all_stub).

    Falls back to neutral (50) when all providers are stubs.
    """
    import asyncio
    signals = await asyncio.gather(
        fetch_twitter_sentiment(symbol),
        fetch_reddit_sentiment(symbol),
        fetch_youtube_sentiment(symbol),
        fetch_telegram_sentiment(symbol),
        fetch_google_trends(symbol),
        return_exceptions=True,
    )
    real = [s for s in signals if isinstance(s, SocialSignal) and not s.is_stub]
    if not real:
        return 50.0, True
    avg = sum(s.score for s in real) / len(real)
    return round((avg + 1.0) * 50.0, 1), False

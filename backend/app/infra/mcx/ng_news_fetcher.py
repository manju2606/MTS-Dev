"""International Natural Gas / energy news for the NG-AI Pro score's News
Filter category and the AI Signal tab's news panel (see mcx_ai_score_service.py
-- that category was previously always empty/excluded, "no news source
configured").

Same RSS + keyword-sentiment approach as the equity Discovery Engine
(app/infra/discovery/news_fetcher.py), against energy/commodity feeds
instead of Indian financial ones, filtered down to articles that actually
mention Natural Gas -- OilPrice.com and Investing.com's Commodities feed
cover oil, gold, and other commodities too, not just gas.

Keyword-based sentiment, not an LLM read of the article -- same tradeoff
the Discovery Engine already makes (see sentiment.py), fast and free but
coarse. Good enough for "is recent coverage clearly bullish/bearish", not
for real analysis -- treat it the same way as every other NG-AI Pro
sub-indicator: one input among several, not a signal on its own.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from functools import partial

import feedparser
import httpx
import structlog

from app.domain.models.discovery import NewsItem
from app.infra.discovery.sentiment import score_text

log = structlog.get_logger()

_FEEDS: list[tuple[str, str]] = [
    ("OilPrice.com", "https://oilprice.com/rss/main"),
    ("Investing.com Commodities", "https://www.investing.com/rss/commodities.rss"),
    ("Natural Gas Intel", "https://www.naturalgasintel.com/feed/"),
]

# Relevance filter -- OilPrice.com and Investing.com's feed cover all
# commodities, so an article only counts as NG news if it actually mentions
# one of these. Natural Gas Intel is gas-only already but cheap to also
# filter for consistency.
_NG_KEYWORDS = [
    "natural gas",
    "nat gas",
    "lng",
    "henry hub",
    "gas storage",
    "gas inventor",  # matches "inventory"/"inventories"
    "gas demand",
    "gas supply",
    "gas price",
    "gas futures",
    "gas pipeline",
    "gas export",
    "ttf",  # Dutch TTF gas benchmark
    "nymex gas",
    "eia",
    "heating degree",
    "winter storm",
]

_HTTP_TIMEOUT = 8.0


def _is_ng_relevant(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in _NG_KEYWORDS)


def _parse_feed_sync(content: bytes, source: str) -> list[NewsItem]:
    feed = feedparser.parse(content)
    items: list[NewsItem] = []
    for entry in feed.entries[:20]:
        title = entry.get("title", "").strip()
        link = entry.get("link", "")
        summary = re.sub(r"<[^>]+>", "", entry.get("summary", entry.get("description", "")))[:500]
        text = f"{title} {summary}"
        if not _is_ng_relevant(text):
            continue

        pub = entry.get("published") or entry.get("updated") or ""
        try:
            published_at = parsedate_to_datetime(pub).replace(tzinfo=None)
        except Exception:
            published_at = datetime.utcnow()

        items.append(
            NewsItem(
                title=title,
                source=source,
                url=link,
                published_at=published_at,
                sentiment_score=score_text(text),
                mentioned_symbols=["NATURALGAS"],
                summary=summary[:300],
            )
        )
    return items


async def fetch_ng_news() -> list[NewsItem]:
    """Fetch all NG/energy feeds concurrently, keep only Natural-Gas-relevant
    articles, dedupe by URL."""
    semaphore = asyncio.Semaphore(4)

    async def _fetch_one(source: str, url: str) -> list[NewsItem]:
        async with semaphore:
            try:
                async with httpx.AsyncClient(
                    timeout=_HTTP_TIMEOUT, follow_redirects=True
                ) as client:
                    resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                    if resp.status_code >= 400:
                        return []
                    content = resp.content
                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(None, partial(_parse_feed_sync, content, source))
            except Exception as exc:
                log.warning("ng_news.feed.error", source=source, error=str(exc))
                return []

    results = await asyncio.gather(*[_fetch_one(src, url) for src, url in _FEEDS])
    seen_urls: set[str] = set()
    out: list[NewsItem] = []
    for batch in results:
        for item in batch:
            if item.url not in seen_urls:
                seen_urls.add(item.url)
                out.append(item)
    out.sort(key=lambda n: n.published_at, reverse=True)
    return out

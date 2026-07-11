"""International Base & Precious Metals news for the Metals-AI Pro score's
News Filter category and the AI Signal tab's news panel -- sibling to
ng_news_fetcher.py. Same RSS + keyword-sentiment approach, against the same
two commodity feeds (both already cover metals, not just gas/oil -- NG's
fetcher discards that coverage via its own gas-only keyword filter), plus a
metals-relevant keyword list and a separate Mongo collection
(McxMetalsNewsRepository) so articles never mix with the NG feed.
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
]

# Relevance filter -- both feeds cover the full commodity complex, so an
# article only counts as metals news if it actually mentions one of these.
_METALS_KEYWORDS = [
    "gold", "silver", "bullion", "xau", "xag", "spot gold", "spot silver",
    "aluminium", "aluminum", "copper", "lead", "nickel", "zinc",
    "base metal", "precious metal", "lme", "london metal exchange",
    "mcx gold", "mcx silver", "comex",
]

_HTTP_TIMEOUT = 8.0


def _is_metals_relevant(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in _METALS_KEYWORDS)


def _parse_feed_sync(content: bytes, source: str) -> list[NewsItem]:
    feed = feedparser.parse(content)
    items: list[NewsItem] = []
    for entry in feed.entries[:20]:
        title = entry.get("title", "").strip()
        link = entry.get("link", "")
        summary = re.sub(r"<[^>]+>", "", entry.get("summary", entry.get("description", "")))[:500]
        text = f"{title} {summary}"
        if not _is_metals_relevant(text):
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
                mentioned_symbols=["METALS"],
                summary=summary[:300],
            )
        )
    return items


async def fetch_metals_news() -> list[NewsItem]:
    """Fetch all metals-relevant feeds concurrently, keep only relevant
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
                log.warning("metals_news.feed.error", source=source, error=str(exc))
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

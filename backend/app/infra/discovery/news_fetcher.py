"""RSS news aggregator for Indian financial markets.

Fetches from 20+ financial RSS feeds, scores sentiment, and extracts
mentioned NSE symbols.  All I/O is async; feedparser parsing runs in
a thread-pool executor since feedparser is sync.
"""

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
from app.infra.discovery.universe import COMPANY_NAME_TO_SYMBOL

log = structlog.get_logger()

# Indian financial RSS feeds
_FEEDS: list[tuple[str, str]] = [
    ("ET Markets",         "https://economictimes.indiatimes.com/markets/rss.cms"),
    ("ET Stocks",          "https://economictimes.indiatimes.com/markets/stocks/rss.cms"),
    ("Moneycontrol",       "https://www.moneycontrol.com/rss/latestnews.xml"),
    ("Moneycontrol Markets","https://www.moneycontrol.com/rss/marketreports.xml"),
    ("Business Standard",  "https://www.business-standard.com/rss/markets-106.rss"),
    ("Business Standard 2","https://www.business-standard.com/rss/finance-103.rss"),
    ("LiveMint Markets",   "https://www.livemint.com/rss/markets"),
    ("LiveMint Companies", "https://www.livemint.com/rss/companies"),
    ("Financial Express",  "https://www.financialexpress.com/market/feed/"),
    ("NDTV Profit",        "https://www.ndtvprofit.com/feed"),
    ("Hindu BusinessLine", "https://www.thehindubusinessline.com/feeder/default.rss"),
    ("Zee Business",       "https://www.zeebiz.com/rss"),
    ("CNBCTV18 Markets",   "https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml"),
    ("Investing.com IN",   "https://in.investing.com/rss/news.rss"),
    ("Reuters India Biz",  "https://feeds.reuters.com/reuters/INbusinessNews"),
    ("Bloomberg Quint",    "https://www.bqprime.com/feeds/latest"),
    ("NSE Press",          "https://www.nseindia.com/feed/news.xml"),
    ("Mint Tech",          "https://www.livemint.com/rss/technology"),
    ("FE Companies",       "https://www.financialexpress.com/companies/feed/"),
    ("MC Earnings",        "https://www.moneycontrol.com/rss/earnings.xml"),
]

_SYMBOL_PATTERN = re.compile(r"\b([A-Z]{2,10})\b")
_HTTP_TIMEOUT = 8.0


def _parse_feed_sync(content: bytes, source: str) -> list[NewsItem]:
    """Parse RSS bytes → NewsItem list (runs in executor)."""
    feed = feedparser.parse(content)
    items: list[NewsItem] = []
    for entry in feed.entries[:15]:  # cap per feed to avoid floods
        title = entry.get("title", "").strip()
        link = entry.get("link", "")
        summary = entry.get("summary", entry.get("description", ""))[:500]
        # Parse publish time
        pub = entry.get("published") or entry.get("updated") or ""
        try:
            published_at = parsedate_to_datetime(pub).replace(tzinfo=None)
        except Exception:
            published_at = datetime.utcnow()

        text = f"{title} {summary}"
        sentiment = score_text(text)
        symbols = _extract_symbols(text)

        items.append(NewsItem(
            title=title,
            source=source,
            url=link,
            published_at=published_at,
            sentiment_score=sentiment,
            mentioned_symbols=symbols,
            summary=summary[:300],
        ))
    return items


def _extract_symbols(text: str) -> list[str]:
    found: set[str] = set()
    lower = text.lower()
    # Company name matching
    for keyword, sym in COMPANY_NAME_TO_SYMBOL.items():
        if keyword in lower:
            found.add(sym)
    # Uppercase ticker pattern (e.g. "RELIANCE", "TCS")
    for match in _SYMBOL_PATTERN.finditer(text):
        candidate = match.group(1) + ".NS"
        if candidate in _known_symbols:
            found.add(candidate)
    return sorted(found)[:10]  # cap at 10 per article


_known_symbols: set[str] = set()


def _init_symbol_set() -> None:
    from app.infra.discovery.universe import UNIVERSE_SYMBOLS
    _known_symbols.update(UNIVERSE_SYMBOLS)


async def fetch_all_news() -> list[NewsItem]:
    """Fetch all RSS feeds concurrently and return deduplicated NewsItem list."""
    if not _known_symbols:
        _init_symbol_set()

    semaphore = asyncio.Semaphore(8)

    async def _fetch_one(source: str, url: str) -> list[NewsItem]:
        async with semaphore:
            try:
                async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, follow_redirects=True) as client:
                    resp = await client.get(url)
                    if resp.status_code >= 400:
                        return []
                    content = resp.content
                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(None, partial(_parse_feed_sync, content, source))
            except Exception as exc:
                log.warning("news.feed.error", source=source, error=str(exc))
                return []

    results = await asyncio.gather(*[_fetch_one(src, url) for src, url in _FEEDS])
    all_items: list[NewsItem] = []
    seen_urls: set[str] = set()
    for batch in results:
        for item in batch:
            if item.url not in seen_urls:
                seen_urls.add(item.url)
                all_items.append(item)

    log.info("news.fetch.done", total_items=len(all_items), feeds=len(_FEEDS))
    return all_items

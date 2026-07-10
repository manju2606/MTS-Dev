"""MongoDB repository for international Natural Gas / energy news (see
app/infra/mcx/ng_news_fetcher.py). One document per article, keyed by its
own URL so repeated scheduler runs upsert instead of accumulating duplicate
copies of the same headline every 30 minutes.
"""

from __future__ import annotations

from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings
from app.domain.models.discovery import NewsItem

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxNewsRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_ng_news"]

    async def save_news(self, items: list[NewsItem]) -> int:
        """Upserts by URL; returns how many were genuinely new."""
        saved = 0
        for n in items:
            result = await self._col.update_one(
                {"_id": n.url},
                {
                    "$setOnInsert": {
                        "_id": n.url,
                        "title": n.title,
                        "source": n.source,
                        "url": n.url,
                        "published_at": n.published_at,
                        "sentiment_score": n.sentiment_score,
                        "summary": n.summary,
                        "fetched_at": n.fetched_at,
                    }
                },
                upsert=True,
            )
            if result.upserted_id is not None:
                saved += 1
        return saved

    async def get_recent(self, limit: int = 30, since: datetime | None = None) -> list[dict]:
        query: dict[str, object] = {}
        if since is not None:
            query["published_at"] = {"$gte": since}
        cursor = self._col.find(query, {"_id": 0}).sort("published_at", -1).limit(limit)
        return [d async for d in cursor]

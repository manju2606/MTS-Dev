"""MongoDB-backed repository for discovery engine results.

Collections (in mts_journal DB):
  discovery_scores  — StockScore snapshots from each scan run
  discovery_news    — NewsItem objects from RSS aggregation
"""

from datetime import datetime
from uuid import UUID

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.discovery import NewsItem, StockScore

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class DiscoveryRepository:
    @property
    def _scores(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["discovery_scores"]

    @property
    def _news(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["discovery_news"]

    # ── Write ────────────────────────────────────────────────────────────────

    async def save_scores(self, scores: list[StockScore]) -> None:
        if not scores:
            return
        docs = [_score_to_doc(s) for s in scores]
        try:
            await self._scores.insert_many(docs, ordered=False)
            log.info("discovery.scores.saved", count=len(docs))
        except Exception as exc:
            log.error("discovery.scores.save_error", error=str(exc))

    async def save_news(self, items: list[NewsItem]) -> None:
        if not items:
            return
        docs = [_news_to_doc(n) for n in items]
        try:
            await self._news.insert_many(docs, ordered=False)
        except Exception as exc:
            log.warning("discovery.news.save_error", error=str(exc))

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get_top_picks(
        self,
        limit: int = 20,
        signal_filter: str | None = None,
        min_score: float = 0.0,
    ) -> list[StockScore]:
        """Return latest StockScore per symbol, sorted by score desc."""
        pipeline: list[dict] = [
            {"$sort": {"scanned_at": -1}},
            {"$group": {"_id": "$symbol", "doc": {"$first": "$$ROOT"}}},
            {"$replaceRoot": {"newRoot": "$doc"}},
            {"$match": {"score": {"$gte": min_score}}},
        ]
        if signal_filter:
            # "BUY" → includes STRONG_BUY; "SELL" → includes STRONG_SELL
            if signal_filter == "BUY":
                pipeline.append({"$match": {"signal": {"$in": ["BUY", "STRONG_BUY"]}}})
            elif signal_filter == "SELL":
                pipeline.append({"$match": {"signal": {"$in": ["SELL", "STRONG_SELL"]}}})
            else:
                pipeline.append({"$match": {"signal": signal_filter}})
        pipeline += [
            {"$sort": {"score": -1}},
            {"$limit": limit},
        ]
        try:
            cursor = self._scores.aggregate(pipeline)
            return [_doc_to_score(doc) async for doc in cursor]
        except Exception as exc:
            log.error("discovery.top_picks.error", error=str(exc))
            return []

    async def get_scores_for_symbol(
        self,
        symbol: str,
        limit: int = 20,
    ) -> list[StockScore]:
        try:
            cursor = self._scores.find(
                {"symbol": symbol}
            ).sort("scanned_at", -1).limit(limit)
            return [_doc_to_score(doc) async for doc in cursor]
        except Exception as exc:
            log.error("discovery.symbol_history.error", symbol=symbol, error=str(exc))
            return []

    async def get_news(
        self,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[NewsItem]:
        query: dict = {}
        if symbol:
            query["mentioned_symbols"] = symbol
        try:
            cursor = self._news.find(query).sort("fetched_at", -1).limit(limit)
            return [_doc_to_news(doc) async for doc in cursor]
        except Exception as exc:
            log.error("discovery.news.error", error=str(exc))
            return []

    async def get_latest_scan_time(self) -> datetime | None:
        try:
            doc = await self._scores.find_one(
                {}, sort=[("scanned_at", -1)], projection={"scanned_at": 1}
            )
            if doc:
                return doc["scanned_at"]
        except Exception:
            pass
        return None

    async def count_latest_scan(self) -> int:
        try:
            latest = await self.get_latest_scan_time()
            if not latest:
                return 0
            # Count docs within 5 minutes of the latest scan
            from datetime import timedelta
            cutoff = latest - timedelta(minutes=5)
            return await self._scores.count_documents({"scanned_at": {"$gte": cutoff}})
        except Exception:
            return 0


# ── Serialization helpers ─────────────────────────────────────────────────────

def _score_to_doc(s: StockScore) -> dict:
    return {
        "_id": str(s.id),
        "symbol": s.symbol,
        "name": s.name,
        "score": s.score,
        "signal": s.signal,
        "confidence": s.confidence,
        "entry_price": s.entry_price,
        "stop_loss": s.stop_loss,
        "targets": s.targets,
        "holding_period": s.holding_period,
        "risk_reward_ratio": s.risk_reward_ratio,
        "technical_score": s.technical_score,
        "news_score": s.news_score,
        "ml_score": s.ml_score,
        "social_score": s.social_score,
        "patterns": s.patterns,
        "news_summary": s.news_summary,
        "explanation": s.explanation,
        "scanned_at": s.scanned_at,
    }


def _doc_to_score(doc: dict) -> StockScore:
    return StockScore(
        id=UUID(doc["_id"]),
        symbol=doc["symbol"],
        name=doc.get("name", doc["symbol"]),
        score=doc["score"],
        signal=doc["signal"],
        confidence=doc["confidence"],
        entry_price=doc["entry_price"],
        stop_loss=doc["stop_loss"],
        targets=doc.get("targets", []),
        holding_period=doc.get("holding_period", ""),
        risk_reward_ratio=doc.get("risk_reward_ratio", 0.0),
        technical_score=doc.get("technical_score", 0.0),
        news_score=doc.get("news_score", 50.0),
        ml_score=doc.get("ml_score", 50.0),
        social_score=doc.get("social_score", 50.0),
        patterns=doc.get("patterns", []),
        news_summary=doc.get("news_summary", ""),
        explanation=doc.get("explanation", ""),
        scanned_at=doc["scanned_at"],
    )


def _news_to_doc(n: NewsItem) -> dict:
    return {
        "_id": str(n.id),
        "title": n.title,
        "source": n.source,
        "url": n.url,
        "published_at": n.published_at,
        "sentiment_score": n.sentiment_score,
        "mentioned_symbols": n.mentioned_symbols,
        "summary": n.summary,
        "fetched_at": n.fetched_at,
    }


def _doc_to_news(doc: dict) -> NewsItem:
    return NewsItem(
        id=UUID(doc["_id"]),
        title=doc["title"],
        source=doc["source"],
        url=doc.get("url", ""),
        published_at=doc["published_at"],
        sentiment_score=doc.get("sentiment_score", 0.0),
        mentioned_symbols=doc.get("mentioned_symbols", []),
        summary=doc.get("summary", ""),
        fetched_at=doc.get("fetched_at", datetime.utcnow()),
    )

"""Market data source management API.

Endpoints for inspecting source health, fetching a quote from all sources
simultaneously (for comparison), and setting priority order.
"""

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/market-data", tags=["market-data"])


@router.get("/sources/health")
async def source_health(_: CurrentUser) -> list[dict]:
    """Return health stats for each configured market data source."""
    from app.infra.market_data.composite_client import get_all_source_health

    return get_all_source_health()


@router.get("/sources/compare")
async def compare_sources(
    _: CurrentUser,
    symbol: str = Query(..., description="NSE/BSE symbol, e.g. RELIANCE or TCS.NS"),
) -> dict:
    """Fetch a quote from ALL sources simultaneously and return side-by-side comparison."""
    from app.infra.market_data.composite_client import CompositeMarketDataClient

    client = CompositeMarketDataClient()
    return await client.get_quote_multi_source(symbol)


@router.get("/sources/list")
async def list_sources(_: CurrentUser) -> list[dict]:
    """Return the available market data sources and their descriptions."""
    return [
        {
            "id": "nse_india",
            "name": "NSE India",
            "description": (
                "Official NSE website JSON API — real-time equity quotes with full OHLCV"
            ),
            "url": "https://www.nseindia.com",
            "priority": 1,
            "coverage": "NSE equities, indices, derivatives",
            "delay": "Near real-time (< 5 min during market hours)",
            "official": True,
        },
        {
            "id": "yahoo",
            "name": "Yahoo Finance",
            "description": (
                "Yahoo Finance via yfinance — robust, covers NSE/BSE/global, historical data"
            ),
            "url": "https://finance.yahoo.com",
            "priority": 2,
            "coverage": "NSE/BSE/global equities, ETFs, indices",
            "delay": "15-minute delay for NSE/BSE",
            "official": False,
        },
        {
            "id": "moneycontrol",
            "name": "MoneyControl",
            "description": "MoneyControl price widget API — covers most Nifty 500 stocks",
            "url": "https://www.moneycontrol.com",
            "priority": 3,
            "coverage": "NSE/BSE equities (Nifty 500)",
            "delay": "Near real-time",
            "official": False,
        },
        {
            "id": "google",
            "name": "Google Finance",
            "description": "Google Finance unofficial endpoint — best-effort, may be unavailable",
            "url": "https://finance.google.com",
            "priority": 4,
            "coverage": "NSE/BSE equities (limited)",
            "delay": "Near real-time",
            "official": False,
        },
        {
            "id": "economic_times",
            "name": "Economic Times",
            "description": "Used as NEWS source (RSS feed). Quote data sourced via NSE India.",
            "url": "https://economictimes.indiatimes.com/markets",
            "priority": None,
            "coverage": "News & sentiment (20 articles/refresh)",
            "delay": "RSS refresh every 15 min",
            "official": False,
            "news_only": True,
        },
    ]

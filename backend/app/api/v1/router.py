from fastapi import APIRouter

from app.api.v1 import (
    admin,
    ai,
    alerting,
    alerts,
    audit_api,
    auth,
    backtest,
    broker,
    btst,
    calendar,
    chartink,
    crypto,
    custom_screener,
    dashboard,
    discovery,
    dsws,
    forecast,
    golden_egg,
    golden_stock,
    historical_data,
    international_market,
    journal,
    kotegawa,
    kotegawa_early,
    kotegawa_intraday,
    live,
    market_pulse,
    market_sources,
    mcx,
    mcx_correlation,
    mcx_gold_strategy,
    mcx_metals,
    mcx_ng_strategy,
    mcx_silver_strategy,
    mcx_strategy_dashboard,
    ml_api,
    notifications,
    options,
    org_api,
    paper,
    performance,
    portfolio,
    research,
    risk,
    scanner,
    sentiment_forecast,
    stock_analysis,
    stock_of_day,
    strategy_api,
    strategy_lab,
    tax_report,
    trading_agent,
    usa_stocks,
    usage,
    watchlist_history,
    webhook_api,
    ws,
)

router = APIRouter()


@router.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


router.include_router(auth.router)
router.include_router(scanner.router)
router.include_router(paper.router)
router.include_router(ai.router)
router.include_router(risk.router)
router.include_router(backtest.router)
router.include_router(broker.router)
router.include_router(live.router)
router.include_router(ml_api.router)
router.include_router(admin.router)
router.include_router(research.router)
router.include_router(market_pulse.router)
router.include_router(portfolio.router)
router.include_router(alerts.router)
router.include_router(journal.router)
router.include_router(usage.router)
router.include_router(dashboard.router)
router.include_router(discovery.router)
router.include_router(forecast.router)
router.include_router(stock_analysis.router)
router.include_router(stock_of_day.router)
router.include_router(market_sources.router)
router.include_router(org_api.router)
router.include_router(strategy_api.router)
router.include_router(webhook_api.router)
router.include_router(ws.router)
router.include_router(notifications.router)
router.include_router(tax_report.router)
router.include_router(audit_api.router)
router.include_router(options.router)
router.include_router(calendar.router)
router.include_router(custom_screener.router)
router.include_router(golden_egg.router)
router.include_router(golden_stock.router)
router.include_router(btst.router)
router.include_router(kotegawa.router)
router.include_router(kotegawa_early.router)
router.include_router(kotegawa_intraday.router)
router.include_router(watchlist_history.router)
router.include_router(sentiment_forecast.router)
router.include_router(trading_agent.router)
router.include_router(alerting.router)
router.include_router(chartink.router)
router.include_router(dsws.router)
router.include_router(mcx.router)
router.include_router(mcx_metals.router)
router.include_router(mcx_silver_strategy.router)
router.include_router(mcx_gold_strategy.router)
router.include_router(mcx_ng_strategy.router)
router.include_router(mcx_correlation.router)
router.include_router(mcx_strategy_dashboard.router)
router.include_router(crypto.router)
router.include_router(usa_stocks.router)
router.include_router(international_market.router)
router.include_router(historical_data.router)
router.include_router(strategy_lab.router)
router.include_router(performance.router)

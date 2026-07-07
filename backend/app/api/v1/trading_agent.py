"""Chat Trading Agent — a rule-based platform guide that answers "how do I use
X" questions about every part of Manju Trade AI Pro, with light live context
(open/pending trades, holdings, market hours) pulled from the user's own
account so answers feel grounded rather than generic documentation.

Deliberately keyword-matched rather than LLM-backed (same approach as the
Portfolio Assistant chat in portfolio.py) — the set of questions a platform
guide needs to answer is finite and well-known, so this is fast, free, and
always available regardless of whether an AI provider key is configured.
"""

from uuid import UUID

from fastapi import APIRouter, Body

from app.api.deps import CurrentUser, TradeDep
from app.domain.models.trade import TradeStatus
from app.infra.market.hours import is_market_open_ist

router = APIRouter(prefix="/agent", tags=["trading-agent"])

# Topic id -> (href, label) so the chat can offer a clickable link, not just
# describe where a feature lives.
_TOPIC_HREFS: dict[str, tuple[str, str]] = {
    "quick_trade": ("/trade", "Quick Trade"),
    "limit_pending": ("/paper?tab=pending", "Pending Orders"),
    "paper_trading": ("/paper", "Paper Trading"),
    "golden_stock": ("/golden-stock", "Golden Stock"),
    "btst": ("/btst", "BTST"),
    "risk": ("/risk", "Risk"),
    "portfolio_assistant": ("/portfolio/assistant", "Portfolio Assistant"),
    "portfolio_summary_tab": ("/portfolio/assistant", "Portfolio Assistant"),
    "sentiment_forecast": ("/sentiment-forecast", "Sentiment Forecast"),
    "tax": ("/tax", "Tax Report"),
    "reports": ("/reports", "Reports"),
    "backtest": ("/backtest", "Backtest"),
    "strategy_builder": ("/strategy", "Strategy Builder"),
    "alerts": ("/alerts", "Alerts"),
    "webhooks": ("/webhooks", "Webhooks"),
    "broker": ("/broker", "Broker"),
    "live_trading": ("/live", "Live Trading"),
    "scanner": ("/scanner", "Scanner"),
    "screener": ("/screener", "Custom Screener"),
    "heatmap": ("/heatmap", "Heat Map"),
    "options": ("/options", "Options Chain"),
    "calendar": ("/calendar", "Economic Calendar"),
    "discovery": ("/discovery", "Discovery"),
    "ml_signals": ("/ml", "ML Signals"),
    "ai_analysis": ("/ai", "AI Analysis"),
    "research": ("/research", "Research"),
    "market_pulse": ("/market-pulse", "Market Pulse"),
    "watchlists": ("/watchlists", "Watchlists"),
    "tradingview": ("/tradingview", "TradingView"),
    "stock_of_day": ("/stock-of-day", "Stock of Day"),
    "dashboard": ("/dashboard", "Dashboard"),
}

_TRADE_TAB_LINKS: dict[str, tuple[str, str]] = {
    "open": ("/paper?tab=open", "Open Trades"),
    "pending": ("/paper?tab=pending", "Pending Orders"),
    "closed": ("/paper?tab=closed", "Closed Trades"),
    "holdings": ("/portfolio/assistant", "Portfolio Assistant"),
}

_NAV_VERBS = ("open my", "open the", "go to", "take me to", "navigate to", "bring me to")


class _Topic:
    def __init__(
        self, id: str, keywords: list[str], answer: str, suggestions: list[str] | None = None
    ):
        self.id = id
        self.keywords = keywords
        self.answer = answer
        self.suggestions = suggestions or []


_TOPICS: list[_Topic] = [
    _Topic(
        "quick_trade",
        ["quick trade", "place a trade", "how do i trade", "buy a stock", "how to trade"],
        (
            "**Quick Trade** (Trading → Quick Trade) is the fastest way to place a paper trade:\n"
            "1. Search for a stock — you'll see live indicators (RSI, MACD, SMA, Bollinger Bands) and an AI signal.\n"
            "2. Review the auto-filled Entry/Stop Loss/Target (from the AI signal, editable).\n"
            "3. Choose MARKET (fills immediately at LTP, only while the market is open) or LIMIT "
            "(queues as **Pending** until the price you set is actually reached).\n"
            "4. Click **Check Risk** to validate against your risk config, then **Place Paper BUY/SELL**.\n"
            "There's also a **Chart** toggle to see the candlestick chart with your levels overlaid."
        ),
        ["What's the difference between MARKET and LIMIT orders?", "How does Paper Trading work?"],
    ),
    _Topic(
        "limit_pending",
        ["limit order", "pending order", "pending trade", "market hours", "market closed"],
        (
            "**LIMIT orders queue as Pending** — they don't fill instantly. The position only opens once "
            "the live price actually reaches your specified level, and only during NSE market hours "
            "(9:15 AM–3:30 PM IST, Mon–Fri). You can see and cancel pending orders under the "
            "**Pending** tab on the Paper Trading page. MARKET orders fill immediately at the current "
            "price, but only while the market is open — they're rejected outside market hours since "
            "there's no live price to fill at."
        ),
        ["How do I place a trade?", "How do I close a position?"],
    ),
    _Topic(
        "paper_trading",
        ["paper trading", "paper trade", "simulated trade", "close position", "close a trade"],
        (
            "**Paper Trading** (Trading → Paper Trading) simulates trades with zero real risk. "
            "Positions are split into three tabs: **Open**, **Pending** (unfilled LIMIT orders), and "
            "**Closed**. To close a position, click **Close Position** — it always opens a price "
            "confirmation form (pre-filled with the live price) rather than closing instantly, and the "
            "price you enter is checked against that stock's actual traded range for the day so you "
            "can't record an unrealistic fill. Each open position also shows live P&L in ₹ and %, a "
            "buy-price/current-price marker on the SL→Target bar, and a chart toggle."
        ),
        ["How does the manual close price check work?", "What is Stock of the Day auto-trading?"],
    ),
    _Topic(
        "golden_stock",
        ["golden stock", "intraday pick", "intraday scan"],
        (
            "**Golden Stock** (Trading → Golden Stock) runs a two-pass intraday scanner scoring stocks "
            "on fundamentals, technicals, and momentum, refreshed every 15 minutes during market hours. "
            "Entry/Stop Loss/Target are sized to each stock's own ATR-14 (average true range) rather "
            "than a flat percentage — a low-volatility large-cap gets a tighter, more realistic target "
            "than a genuinely volatile small-cap."
        ),
        ["How is the target price calculated?", "What is BTST?"],
    ),
    _Topic(
        "btst",
        ["btst", "buy today sell tomorrow"],
        (
            "**BTST** (Buy Today, Sell Tomorrow) scans for breakout stocks with strong relative strength "
            "vs Nifty, favorable F&O positioning, and news sentiment, meant to be held overnight rather "
            "than closed same-session. Like Golden Stock, its stop/target are sized to the stock's own "
            "ATR rather than a flat percentage, with a slightly wider band since it's held over 1+ days."
        ),
        ["How is the target price calculated?", "What is Golden Stock?"],
    ),
    _Topic(
        "risk",
        [
            "risk engine",
            "stop loss",
            "position sizing",
            "max daily loss",
            "risk config",
            "kill switch",
        ],
        (
            "The **Risk Engine** (Trading → Risk) is a hard gate — it overrides AI signals, not the other "
            "way round. It enforces max daily loss, max drawdown, position sizing limits, sector "
            "exposure limits, and an emergency kill switch. Every trade must have an entry price, stop "
            "loss, target, and position size before it can execute. Use **Check Risk** on the trade "
            "ticket to validate a trade against your configured limits before placing it."
        ),
        ["How do I place a trade?", "What is Backtest?"],
    ),
    _Topic(
        "portfolio_assistant",
        ["portfolio assistant", "my holdings", "real holdings", "track my portfolio"],
        (
            "**Portfolio Assistant** (Portfolio → Portfolio Assistant) tracks your real brokerage "
            "holdings (separate from paper trading) across tabs: Overview, Holdings, Allocation, Risk, "
            "Performance, Research, **Summary** (Day/Week/Month performance with suggestions on what to "
            'review), and AI Assistant (ask it questions like "why is my portfolio underperforming" '
            'or "what\'s my riskiest holding", grounded in your actual holdings).'
        ),
        ["What does the Summary tab show?", "How do I add a holding?"],
    ),
    _Topic(
        "portfolio_summary_tab",
        [
            "summary tab",
            "weekly summary",
            "monthly summary",
            "daily summary",
            "how did my portfolio do",
        ],
        (
            "The **Summary** tab in Portfolio Assistant shows how your portfolio actually performed over "
            "Today/This Week/This Month: portfolio change vs Nifty50, which holdings are up/down and by "
            "how much, sector-level moves, and rule-based suggestions — e.g. flagging a holding down more "
            "than 8% to review your stop-loss, one up more than 15% to consider booking profits, or a "
            "single sector making up over 40% of the portfolio as a concentration risk."
        ),
        ["What is Portfolio Assistant?"],
    ),
    _Topic(
        "sentiment_forecast",
        ["sentiment forecast", "market sentiment", "bullish or bearish"],
        (
            "**Sentiment Forecast** (Markets → Sentiment Forecast) generates a Monday-to-Friday market "
            "sentiment forecast (Bullish/Bearish/Neutral etc.) from the current AI signal mix, VIX, and "
            "Nifty momentum each Monday morning, then tracks each day's actual outcome against the "
            "forecast to report a running accuracy percentage — so you can see whether the forecast is "
            "actually reliable, not just take it on faith."
        ),
        [],
    ),
    _Topic(
        "tax",
        ["tax report", "stcg", "ltcg", "capital gains"],
        (
            "**Tax Report** (Portfolio → Tax Report) computes STCG/LTCG on your holdings per Indian "
            "equity tax rules and lets you export the breakdown as CSV."
        ),
        [],
    ),
    _Topic(
        "reports",
        ["report history", "hourly report", "daily report"],
        (
            "**Reports** (Portfolio → Reports) is a history of the hourly scan + email report generated "
            "automatically every hour during market hours (8:15 AM–3:15 PM IST), listing that hour's top "
            "actionable picks."
        ),
        [],
    ),
    _Topic(
        "backtest",
        ["backtest", "test a strategy on history"],
        (
            "**Backtest** (Trading → Backtest) runs a strategy against historical price data so you can "
            "see how it would have performed before risking anything on it."
        ),
        ["What is Strategy Builder?"],
    ),
    _Topic(
        "strategy_builder",
        ["strategy builder", "rules based strategy", "custom strategy"],
        (
            "**Strategy Builder** (Trading → Strategy Builder) lets you define rules-based strategies "
            "(entry/exit conditions on indicators) and backtest them directly."
        ),
        ["What is Backtest?"],
    ),
    _Topic(
        "alerts",
        ["alert", "price alert", "notify me"],
        (
            "**Alerts** (Trading → Alerts) lets you set price and signal-based notifications so you're "
            "told when a stock crosses a level you care about, without needing to watch it constantly."
        ),
        [],
    ),
    _Topic(
        "webhooks",
        ["webhook", "http event"],
        (
            "**Webhooks** (Trading → Webhooks) delivers trading events to your own HTTP endpoints — "
            "useful if you want to pipe signals or trade events into another system you run."
        ),
        [],
    ),
    _Topic(
        "broker",
        ["broker", "zerodha", "upstox", "connect my broker"],
        (
            "**Broker** (Trading → Broker) is where you connect a real brokerage account (Zerodha, "
            "Upstox) for Live Trading. Paper Trading needs no broker connection at all — it's fully "
            "simulated."
        ),
        ["What is Live Trading?"],
    ),
    _Topic(
        "live_trading",
        ["live trading", "real order", "real money"],
        (
            "**Live Trading** (Trading → Live Trading) executes real orders through your connected "
            "broker. Everything else in this platform (Paper Trading, Golden Stock, BTST, Stock of the "
            "Day) is simulation-only unless you explicitly place a live order here — nothing risks real "
            "money by default."
        ),
        ["How do I connect a broker?"],
    ),
    _Topic(
        "scanner",
        ["scanner", "technical scan", "institutional scan"],
        (
            "**Scanner** (Markets → Scanner) runs 16 technical & institutional scans (breakouts, "
            "volume surges, RSI extremes, etc.) across the NSE/BSE universe."
        ),
        [],
    ),
    _Topic(
        "screener",
        ["custom screener", "screen stocks", "multi-factor screen"],
        (
            "**Custom Screener** (Markets → Custom Screener) lets you build a multi-factor screen "
            "(combine fundamental + technical filters) across the Nifty 50/100/200/500 universes."
        ),
        [],
    ),
    _Topic(
        "heatmap",
        ["heat map", "heatmap"],
        "**Heat Map** (Markets → Heat Map) shows an NSE-style color-coded market heat map by sector/stock.",
        [],
    ),
    _Topic(
        "options",
        ["option chain", "options chain", "pcr", "max pain"],
        (
            "**Options Chain** (Markets → Options Chain) shows the NSE/BSE options chain with Put-Call "
            "Ratio (PCR) and max pain calculation for a symbol."
        ),
        [],
    ),
    _Topic(
        "calendar",
        ["economic calendar", "expiry date", "rbi mpc", "earnings calendar"],
        (
            "**Economic Calendar** (Markets → Economic Calendar) tracks F&O expiries, RBI MPC meetings, "
            "earnings dates, and market holidays."
        ),
        [],
    ),
    _Topic(
        "discovery",
        ["discovery engine", "stock discovery"],
        (
            "**Discovery** (Markets → Discovery) is the stock discovery engine that continuously scans "
            "and scores the market to surface actionable AI picks — it's the same engine that feeds the "
            "hourly email Reports."
        ),
        [],
    ),
    _Topic(
        "ml_signals",
        ["ml signal", "machine learning prediction"],
        "**ML Signals** (Markets → ML Signals) surfaces machine-learning-based price predictions.",
        [],
    ),
    _Topic(
        "ai_analysis",
        ["ai analysis", "ai signal", "how does the ai work"],
        (
            "**AI Analysis** (Markets → AI Analysis) generates a BUY/SELL/HOLD recommendation with "
            "confidence, entry/stop/target, risk-reward ratio, and a plain-English explanation for any "
            "symbol — using Claude if an API key is configured, otherwise a local rule-based engine, so "
            "it always works either way."
        ),
        [],
    ),
    _Topic(
        "research",
        ["research page", "ai powered screener"],
        "**Research** (Markets → Research) is an AI-powered stock screener for finding new ideas.",
        [],
    ),
    _Topic(
        "market_pulse",
        ["market pulse", "live prices", "live indices"],
        (
            "**Market Pulse** (Markets → Market Pulse) shows live prices, index levels, and news in one "
            "place — a good starting point each morning."
        ),
        [],
    ),
    _Topic(
        "watchlists",
        ["watchlist"],
        (
            "**Watchlists** (Trading → Watchlists) let you track stocks with live quotes. You can create "
            'multiple watchlists and add symbols to them from almost anywhere in the app via the "+WL" '
            "button next to a stock."
        ),
        [],
    ),
    _Topic(
        "tradingview",
        ["tradingview", "candlestick chart"],
        (
            "**TradingView** (Trading → TradingView) shows a full candlestick chart with volume, "
            "RSI/MACD/SMA/Bollinger Bands, and the current AI signal overlaid."
        ),
        [],
    ),
    _Topic(
        "stock_of_day",
        ["stock of the day", "sotd", "auto trade"],
        (
            "**Stock of the Day** (Trading → Stock of Day) picks one AI top pick daily and can "
            "auto-place a paper trade when confidence is ≥85% (toggle this in its settings), then "
            "tracks the SL/target automatically."
        ),
        [],
    ),
    _Topic(
        "dashboard",
        ["dashboard", "home page", "main page"],
        (
            "The **Dashboard** is your home page — it summarizes Stock of the Day, Golden Stock, and "
            "BTST picks (Entry/LTP/SL/Target/Score/Status side by side), your Sentiment Forecast, and "
            "quick Trade Now links straight into Quick Trade for any pick."
        ),
        [],
    ),
]

_GREETING_KEYWORDS = (
    "hi",
    "hello",
    "hey",
    "help",
    "what can you do",
    "guide me",
    "getting started",
    "how do i use",
)

_OVERVIEW = (
    "I can help you navigate the whole platform. Here's the shape of it:\n\n"
    "- **Markets** — Market Pulse, Scanner, Research, AI Analysis, ML Signals, Discovery, Heat Map, "
    "Forecast, Sentiment Forecast, Options Chain, Economic Calendar, Custom Screener\n"
    "- **Trading** — Watchlists, TradingView, Quick Trade, Stock of Day, Golden Stock, BTST, Paper "
    "Trading, Live Trading, Broker, Backtest, Strategy Builder, Alerts, Webhooks, Risk\n"
    "- **Portfolio** — Paper Trading P&L, Portfolio Assistant (real holdings + AI analysis), Tax "
    "Report, Reports\n\n"
    'Ask me about any of these, or something specific like "how do I place a trade" or "what is '
    'Golden Stock".'
)

_DEFAULT_SUGGESTIONS = [
    "How do I place a trade?",
    "What is Golden Stock?",
    "How does Paper Trading work?",
    "What does the Risk Engine do?",
]


def _match_topic(q: str) -> _Topic | None:
    best: _Topic | None = None
    best_score = 0
    for topic in _TOPICS:
        score = sum(1 for kw in topic.keywords if kw in q)
        if score > best_score:
            best_score = score
            best = topic
    return best if best_score > 0 else None


async def _live_context(current_user: CurrentUser, trade_repo: TradeDep) -> str | None:
    """A short, grounded status line — only shown when the question is about
    the user's own trades/positions, not for generic platform questions."""
    trades = await trade_repo.list_by_user(current_user.id)
    open_n = sum(1 for t in trades if t.status == TradeStatus.OPEN)
    pending_n = sum(1 for t in trades if t.status == TradeStatus.PENDING)
    market = "open" if is_market_open_ist() else "closed"
    return (
        f"Right now you have {open_n} open paper position(s) and {pending_n} pending order(s), "
        f"and NSE is currently **{market}**."
    )


def _bare(symbol: str) -> str:
    return symbol.replace(".NS", "").replace(".BO", "")


async def _list_open_trades(trade_repo: TradeDep, user_id: UUID) -> str:
    trades = await trade_repo.list_by_user(user_id, TradeStatus.OPEN)
    if not trades:
        return "You have no open positions right now."
    lines = [f"You have {len(trades)} open position(s):", ""]
    for t in trades:
        lines.append(
            f"• **{_bare(t.symbol)}** ({t.signal.value}) — Entry ₹{t.entry_price:.2f}, "
            f"SL ₹{t.stop_loss:.2f}, Target ₹{t.target:.2f}, Qty {t.quantity}"
        )
    return "\n".join(lines)


async def _list_pending_trades(trade_repo: TradeDep, user_id: UUID) -> str:
    trades = await trade_repo.list_by_user(user_id, TradeStatus.PENDING)
    if not trades:
        return "You have no pending LIMIT orders right now."
    lines = [f"You have {len(trades)} pending order(s):", ""]
    for t in trades:
        lines.append(
            f"• **{_bare(t.symbol)}** ({t.signal.value}) — will open at ₹{t.entry_price:.2f}, "
            f"SL ₹{t.stop_loss:.2f}, Target ₹{t.target:.2f}, Qty {t.quantity}"
        )
    return "\n".join(lines)


async def _list_closed_trades(trade_repo: TradeDep, user_id: UUID) -> str:
    trades = await trade_repo.list_by_user(user_id, TradeStatus.CLOSED)
    if not trades:
        return "You have no closed trades yet."
    recent = trades[:10]
    lines = [f"Your last {len(recent)} closed trade(s):", ""]
    for t in recent:
        pnl = t.pnl if t.pnl is not None else 0.0
        sign = "+" if pnl >= 0 else ""
        lines.append(
            f"• **{_bare(t.symbol)}** ({t.signal.value}) — Entry ₹{t.entry_price:.2f} → "
            f"Exit ₹{(t.exit_price or 0):.2f}, P&L {sign}₹{pnl:.2f}"
        )
    return "\n".join(lines)


async def _list_holdings(user_id: UUID) -> str:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(user_id), "default")
    if not holdings:
        return "You have no holdings in Portfolio Assistant yet."
    lines = [f"Your Portfolio Assistant holdings ({len(holdings)}):", ""]
    for h in holdings:
        lines.append(f"• **{_bare(h['symbol'])}** — Qty {h['qty']} @ avg ₹{h['avg_price']:.2f}")
    return "\n".join(lines)


_ACTION_VERBS = (
    "show",
    "list",
    "what are my",
    "give me",
    "display",
    "see my",
    "check my",
    *_NAV_VERBS,
)

_ACTION_INTENTS: list[tuple[tuple[str, ...], str]] = [
    (("open order", "open position", "open trade"), "open"),
    (("pending order", "pending trade"), "pending"),
    (("closed trade", "trade history", "past trades"), "closed"),
    (("my holdings", "portfolio holdings"), "holdings"),
]


def _match_action(q: str) -> str | None:
    """Distinguishes "show me my open orders" (fetch real data) from "what is
    a pending order" (explain the concept, handled by the static topics
    below) — only trigger a live data fetch when there's an explicit
    show/list/open/go-to style verb alongside the noun."""
    if not any(v in q for v in _ACTION_VERBS):
        return None
    for nouns, action in _ACTION_INTENTS:
        if any(n in q for n in nouns):
            return action
    return None


def _link(href: str, label: str) -> dict[str, str]:
    return {"href": href, "label": label}


@router.post("/chat")
async def agent_chat(
    current_user: CurrentUser,
    trade_repo: TradeDep,
    body: dict = Body(...),
) -> dict:
    question: str = str(body.get("question", "")).strip()
    if not question:
        return {"answer": _OVERVIEW, "suggestions": _DEFAULT_SUGGESTIONS, "link": None}

    q = question.lower()

    if any(kw in q for kw in _GREETING_KEYWORDS) and len(q) < 60:
        return {"answer": _OVERVIEW, "suggestions": _DEFAULT_SUGGESTIONS, "link": None}

    action = _match_action(q)
    if action is not None:
        href, label = _TRADE_TAB_LINKS[action]
        if action == "open":
            answer = await _list_open_trades(trade_repo, current_user.id)
            suggestions = ["Show me my pending orders", "Show me my closed trades"]
        elif action == "pending":
            answer = await _list_pending_trades(trade_repo, current_user.id)
            suggestions = ["Show me my open orders", "How do pending orders work?"]
        elif action == "closed":
            answer = await _list_closed_trades(trade_repo, current_user.id)
            suggestions = ["Show me my open orders"]
        else:
            answer = await _list_holdings(current_user.id)
            suggestions = ["What does the Summary tab show?"]
        return {"answer": answer, "suggestions": suggestions, "link": _link(href, label)}

    topic = _match_topic(q)
    if topic is None:
        return {
            "answer": (
                "I'm not sure about that one — I can guide you through any feature on the platform. "
                + _OVERVIEW
            ),
            "suggestions": _DEFAULT_SUGGESTIONS,
            "link": None,
        }

    answer = topic.answer
    if any(kw in q for kw in ("my ", "i have", "current", "right now")):
        context = await _live_context(current_user, trade_repo)
        if context:
            answer = f"{answer}\n\n{context}"

    link = None
    if any(v in q for v in _NAV_VERBS) and topic.id in _TOPIC_HREFS:
        href, label = _TOPIC_HREFS[topic.id]
        link = _link(href, label)

    return {"answer": answer, "suggestions": topic.suggestions, "link": link}

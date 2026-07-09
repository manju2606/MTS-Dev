const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export type User = {
  id: string
  email: string
  full_name: string
  role: string
  subscription_tier: 'free' | 'basic' | 'pro'
  email_verified: boolean
}

export type Watchlist = {
  id: string
  user_id: string
  name: string
  created_at: string
}

export type WatchlistItem = {
  id: string
  user_id: string
  watchlist_id: string | null
  symbol: string
  exchange: string
  added_at: string
}

export type Quote = {
  symbol: string
  price: number
  change: number
  change_pct: number
  volume: number
  day_high: number
  day_low: number
  prev_close: number
  exchange: string
}

export type Trade = {
  id: string
  user_id: string
  symbol: string
  exchange: string
  signal: 'BUY' | 'SELL'
  entry_price: number
  stop_loss: number
  target: number
  quantity: number
  mode: 'paper' | 'live'
  status: 'pending' | 'open' | 'closed' | 'cancelled'
  opened_at: string | null
  closed_at: string | null
  exit_price: number | null
  ai_confidence: number | null
  ai_explanation: string | null
  created_at: string
  risk_reward_ratio: number
  pnl: number | null
}

export type PlaceTradeBody = {
  symbol: string
  signal: 'BUY' | 'SELL'
  stop_loss: number
  target: number
  quantity: number
  limit_price?: number
}

export type AIRecommendation = {
  id: string
  symbol: string
  signal: 'BUY' | 'SELL' | 'HOLD'
  confidence: number
  entry_price: number
  stop_loss: number
  target: number
  risk_reward_ratio: number
  holding_period: string
  explanation: string
  engine: 'local' | 'claude'
  generated_at: string
}

export type RiskCheckResult = {
  passed: boolean
  violations: string[]
  max_quantity: number | null
}

export type RiskConfig = {
  capital: number
  max_position_pct: number
  max_daily_loss_pct: number
  max_drawdown_pct: number
  min_risk_reward: number
  max_stop_pct: number
}

export type RiskStatus = {
  open_trades: number
  circuit_breaker_active: boolean
  daily_pnl: number
}

export type BacktestTrade = {
  date_in: string
  date_out: string
  signal: string
  entry: number
  exit: number
  pnl: number
  pnl_pct: number
}

export type BacktestResult = {
  symbol: string
  strategy: string
  period: string
  start_date: string
  end_date: string
  total_return_pct: number
  max_drawdown_pct: number
  win_rate_pct: number
  total_trades: number
  sharpe_ratio: number
  trades: BacktestTrade[]
  equity_curve: { date: string; value: number }[]
}

// Phase 3 — Broker & Live Trading
export type BrokerStatus = {
  broker: string
  connected: boolean
  note?: string
}

export type LiveOrder = {
  id: string
  user_id: string
  symbol: string
  exchange: string
  signal: string
  quantity: number
  order_type: string
  broker: string
  broker_order_id: string | null
  status: string
  price: number | null
  fill_price: number | null
  fill_time: string | null
  created_at: string
}

export type LivePosition = {
  symbol: string
  exchange: string
  signal: string
  quantity: number
  avg_price: number
  ltp?: number
  pnl?: number
  pnl_pct?: number
}

export type BrokerPosition = {
  symbol: string
  qty: number
  avg_price: number
  broker: string
  exchange: string
}

// Phase 4 — ML & Admin
export type MLPrediction = {
  symbol: string
  prediction: 'UP' | 'DOWN'
  probability: number
  feature_importances: Record<string, number>
  training_samples: number
  accuracy_cv: number
}

export type AdminUser = {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
}

export type AdminStats = {
  total_users: number
  active_users: number
  total_trades: number
  open_trades: number
  users_by_role: Record<string, number>
}

export type EmailRecipient = {
  id: string
  email: string
  label: string
  active: boolean
  added_at: string
}

export type SentimentTag = { label: string; color: string }

export type PulseCard = {
  symbol: string
  sector: string
  name: string
  price: number
  change_pct: number
  volume: number
  week52_high: number
  week52_low: number
  sma20: number
  sma50: number
  rsi: number
  momentum_score: number
  value_score: number
  combined_score: number
  signal: string
  ai_confidence: number
  entry_price: number
  stop_loss: number
  target: number
  risk_reward_ratio: number
  holding_period: string
  explanation: string
  engine: string
  sentiment_tags: SentimentTag[]
}

export type MarketOverview = {
  scanned: number
  bullish: number
  bearish: number
  neutral: number
  bullish_pct: number
  bearish_pct: number
  sector_sentiment: Record<string, string>
}

export type MarketPulseResult = {
  overview: MarketOverview
  buy_picks: PulseCard[]
  sell_picks: PulseCard[]
}

export type ScanResult = {
  symbol: string
  name: string
  price: number
  change_pct: number
  volume: number
  day_high: number
  day_low: number
  week52_high: number
  week52_low: number
  sma20: number
  sma50: number
  rsi: number
  momentum_score: number
  value_score: number
  combined_score: number
  signal: string
  rationale: string[]
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Invalid email or password')
  }
  return res.json() as Promise<{ access_token: string; token_type: string }>
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function getMe(token: string): Promise<User> {
  const res = await fetch(`${BASE}/api/v1/auth/me`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new ApiError('Unauthorized', res.status)
  return res.json()
}

// ── Multi-watchlist ────────────────────────────────────────────────────────

export async function listWatchlists(token: string): Promise<Watchlist[]> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch watchlists')
  return res.json()
}

export async function createWatchlist(token: string, name: string): Promise<Watchlist> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to create watchlist')
  }
  return res.json()
}

export async function renameWatchlist(token: string, id: string, name: string): Promise<Watchlist> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to rename watchlist')
  }
  return res.json()
}

export async function deleteWatchlist(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to delete watchlist')
  }
}

export type WatchlistQuote = {
  symbol: string
  display_symbol: string
  company_name: string
  exchange: string
  sector: string
  market_cap_category: string
  index_membership: string[]
  // Price action
  ltp: number
  prev_close: number
  change: number
  change_pct: number
  open: number
  day_high: number
  day_low: number
  vwap: number
  atp: number
  // Volume
  volume: number
  avg_volume: number
  vol_ratio: number
  // 52W
  week52_high: number
  week52_low: number
  pct_from_52w_high: number
  pct_from_52w_low: number
  // Trend / MA
  sma20: number
  sma50: number
  sma200: number
  above_sma20: boolean | null
  above_sma50: boolean | null
  above_sma200: boolean | null
  trend: 'BULLISH' | 'BEARISH' | 'MIXED'
  // Technical
  rsi: number
  macd: number
  macd_signal: number
  macd_hist: number
  bb_upper: number
  bb_mid: number
  bb_lower: number
  error: string | null
}

export async function getQuoteDetail(token: string, symbol: string): Promise<WatchlistQuote> {
  const res = await fetch(`${BASE}/api/v1/scanner/quote-detail/${encodeURIComponent(symbol)}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getWatchlistQuotes(token: string, watchlistId: string): Promise<WatchlistQuote[]> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${watchlistId}/quotes`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Failed to fetch watchlist quotes')
  return res.json()
}

export async function getWatchlistItems(token: string, watchlistId: string): Promise<WatchlistItem[]> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${watchlistId}/items`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Failed to fetch items')
  return res.json()
}

export async function addItemToWatchlist(
  token: string,
  watchlistId: string,
  symbol: string,
): Promise<WatchlistItem> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${watchlistId}/items`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to add symbol')
  }
  return res.json()
}

export async function removeItemFromWatchlist(
  token: string,
  watchlistId: string,
  symbol: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/api/v1/scanner/watchlists/${watchlistId}/items/${encodeURIComponent(symbol)}`,
    { method: 'DELETE', headers: authHeaders(token) },
  )
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to remove symbol')
  }
}

export async function seedWatchlistDefaults(
  token: string,
  watchlistId: string,
): Promise<{ added: number }> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlists/${watchlistId}/seed-defaults`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Failed to seed defaults')
  return res.json()
}

// ── Portfolio ──────────────────────────────────────────────────────────────

export type PortfolioSummary = {
  total_invested: number
  unrealized_pnl: number
  realized_pnl: number
  total_pnl: number
  open_positions: number
  closed_trades: number
  total_trades: number
  winners: number
  losers: number
  win_rate: number
}

export type PortfolioPosition = {
  id: string
  symbol: string
  exchange: string
  signal: 'BUY' | 'SELL'
  quantity: number
  entry_price: number
  current_price: number
  stop_loss: number
  target: number
  invested: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  days_held: number
  ai_confidence: number | null
  opened_at: string | null
}

export type PortfolioClosedTrade = {
  id: string
  symbol: string
  exchange: string
  signal: 'BUY' | 'SELL'
  quantity: number
  entry_price: number
  exit_price: number | null
  pnl: number
  pnl_pct: number
  days_held: number
  closed_at: string | null
}

export type EquityPoint = { time: number; value: number }

export type PortfolioData = {
  summary: PortfolioSummary
  positions: PortfolioPosition[]
  closed_trades: PortfolioClosedTrade[]
  equity_curve: EquityPoint[]
  sector_allocation: Record<string, number>
}

export async function getPortfolio(token: string): Promise<PortfolioData> {
  const res = await fetch(`${BASE}/api/v1/portfolio/summary`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch portfolio')
  return res.json()
}

// ── Portfolio Assistant ─────────────────────────────────────────────────────

export type Holding = {
  id: string
  symbol: string
  name: string
  qty: number
  avg_price: number
  current_price: number
  invested: number
  current_value: number
  pnl: number
  pnl_pct: number
  sector: string
  recommendation: 'BUY' | 'HOLD' | 'SELL' | 'ADD' | 'REVIEW'
  rec_reason: string
  ai_score: number | null
  ai_signal: string | null
  ai_confidence: number | null
  ai_stop_loss: number | null
  ai_targets: number[]
  buy_date: string | null
}

export type AssistantSummary = {
  total_invested: number
  current_value: number
  total_pnl: number
  total_pnl_pct: number
  holdings_count: number
  winners: number
  losers: number
  win_rate: number
  health_score: number
  diversification_score: number
}

export type AssistantAlert = {
  symbol: string
  type: 'LOSS' | 'TARGET'
  severity: 'high' | 'medium'
  message: string
}

export type SizingRow = {
  symbol: string
  weight_pct: number
  flag: 'OVERWEIGHT' | 'OK' | 'UNDERWEIGHT'
  invested: number
}

export type AssistantAnalysis = {
  holdings: Holding[]
  summary: AssistantSummary
  sector_allocation: Record<string, number>
  alerts: AssistantAlert[]
  risk: {
    level: string
    worst_position_pct: number
    best_position_pct: number
    portfolio_volatility: number
    concentration_risk: number
  }
  sizing: SizingRow[]
}

// ── Portfolio (multi-portfolio) ────────────────────────────────────────────────

export type Portfolio = {
  id: string
  portfolio_id: string
  name: string
  created_at: string
  holdings_count: number
}

export async function listPortfolios(token: string): Promise<Portfolio[]> {
  const res = await fetch(`${BASE}/api/v1/portfolio/holdings/portfolios`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function createPortfolio(token: string, name: string): Promise<Portfolio> {
  const res = await fetch(`${BASE}/api/v1/portfolio/holdings/portfolios`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || 'Failed to create portfolio') }
  return res.json()
}

export async function renamePortfolio(token: string, portfolioId: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/portfolio/holdings/portfolios/${encodeURIComponent(portfolioId)}`, {
    method: 'PATCH', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || 'Failed to rename') }
}

export async function deletePortfolio(token: string, portfolioId: string): Promise<void> {
  await fetch(`${BASE}/api/v1/portfolio/holdings/portfolios/${encodeURIComponent(portfolioId)}`, {
    method: 'DELETE', headers: authHeaders(token),
  })
}

export async function getAssistantAnalysis(token: string, portfolioId = 'default'): Promise<AssistantAnalysis> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/analysis?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error('Failed to fetch assistant analysis')
  return res.json()
}

export async function listHoldings(token: string, portfolioId = 'default'): Promise<Holding[]> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/holdings?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

export async function addHolding(token: string, body: {
  symbol: string; name?: string; qty: number; avg_price: number; buy_date?: string; sector?: string; portfolio_id?: string
}): Promise<Holding> {
  const res = await fetch(`${BASE}/api/v1/portfolio/holdings`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || 'Failed to add holding') }
  return res.json()
}

export async function deleteHolding(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/portfolio/holdings/${id}`, { method: 'DELETE', headers: authHeaders(token) })
}

export async function updateHolding(token: string, id: string, qty: number, avg_price: number): Promise<void> {
  await fetch(`${BASE}/api/v1/portfolio/holdings/${id}`, {
    method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty, avg_price }),
  })
}

export async function importHoldings(token: string, rows: {
  symbol: string; name?: string; qty: number; avg_price: number; buy_date?: string
}[], portfolioId = 'default'): Promise<{ imported: number }> {
  const res = await fetch(`${BASE}/api/v1/portfolio/holdings/import`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, portfolio_id: portfolioId }),
  })
  if (!res.ok) throw new Error('Import failed')
  return res.json()
}

export async function askAssistant(token: string, question: string, portfolioId = 'default'): Promise<{ answer: string; sources: string[] }> {
  const res = await fetch(`${BASE}/api/v1/portfolio/assistant/chat`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, portfolio_id: portfolioId }),
  })
  if (!res.ok) throw new Error('Chat failed')
  return res.json()
}

export type FundamentalRow = {
  symbol: string; raw_symbol: string; name: string; sector: string; industry: string
  market_cap: number | null; pe_ratio: number | null; pb_ratio: number | null
  roe: number | null; eps: number | null; beta: number | null; dividend_yield: number | null
  week52_high: number | null; week52_low: number | null; current_price: number | null
  analyst_target: number | null; recommendation: string
  debt_to_equity: number | null; profit_margins: number | null
}
export async function getAssistantFundamentals(token: string, portfolioId = 'default'): Promise<FundamentalRow[]> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/fundamentals?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

export type TimelineData = { dates: string[]; portfolio: number[]; nifty: number[] }
export async function getAssistantTimeline(token: string, portfolioId = 'default'): Promise<TimelineData> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/timeline?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return { dates: [], portfolio: [], nifty: [] }
  return res.json()
}

export type SummaryPeriod = 'day' | 'week' | 'month'

export type SummaryHoldingMove = {
  symbol: string
  name: string
  sector: string
  price_start: number
  price_now: number
  change_pct: number
  value_now: number
}

export type SummarySectorMove = { sector: string; weight_pct: number; change_pct: number }

export type PortfolioSuggestion = { severity: 'warning' | 'info' | 'positive'; text: string }

export type AssistantPeriodSummary = {
  period: SummaryPeriod
  has_data: boolean
  start_date?: string
  end_date?: string
  portfolio_value_start?: number
  portfolio_value_now?: number
  portfolio_change_pct?: number
  nifty_change_pct?: number | null
  nifty_value_start?: number | null
  nifty_value_now?: number | null
  sensex_change_pct?: number | null
  sensex_value_start?: number | null
  sensex_value_now?: number | null
  relative_pct?: number | null
  winners?: SummaryHoldingMove[]
  losers?: SummaryHoldingMove[]
  sector_moves?: SummarySectorMove[]
  suggestions?: PortfolioSuggestion[]
}

export async function getAssistantSummary(
  token: string,
  portfolioId = 'default',
  period: SummaryPeriod = 'week',
  date?: string,
): Promise<AssistantPeriodSummary> {
  const dateParam = period === 'day' && date ? `&date=${encodeURIComponent(date)}` : ''
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/summary?portfolio_id=${encodeURIComponent(portfolioId)}&period=${period}${dateParam}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return { period, has_data: false }
  return res.json()
}

export type OhlcRow = {
  symbol: string
  name: string
  sector: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  change: number
  change_pct: number
  week_52_high: number | null
  week_52_low: number | null
  weekly_change: number | null
  weekly_change_pct: number | null
  monthly_change: number | null
  monthly_change_pct: number | null
  ltp: number | null
  ai_signal: string | null
  confidence_pct: number | null
}

export type PortfolioOhlc = { has_data: boolean; rows: OhlcRow[] }

export async function getAssistantOhlc(
  token: string,
  portfolioId = 'default',
): Promise<PortfolioOhlc> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/ohlc?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return { has_data: false, rows: [] }
  return res.json()
}

export type TaxRow = {
  symbol: string; qty: number; avg_price: number; current_price: number
  invested: number; pnl: number; days_held: number | null
  tax_type: 'STCG' | 'LTCG' | 'Unknown'; tax_rate: number; estimated_tax: number; buy_date: string
}
export type TaxData = {
  rows: TaxRow[]
  summary: { total_stcg: number; total_ltcg: number; stcg_tax: number; ltcg_tax: number; total_tax: number; ltcg_exemption_used: number; note: string }
}
export async function getAssistantTax(token: string, portfolioId = 'default'): Promise<TaxData> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/tax?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return { rows: [], summary: { total_stcg: 0, total_ltcg: 0, stcg_tax: 0, ltcg_tax: 0, total_tax: 0, ltcg_exemption_used: 0, note: '' } }
  return res.json()
}

export type DividendRow = {
  symbol: string; qty: number; avg_price: number
  dividends: { date: string; amount: number }[]
  annual_income_est: number; yield_on_cost: number; current_yield: number; total_received_est: number
}
export async function getAssistantDividends(token: string, portfolioId = 'default'): Promise<DividendRow[]> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/dividends?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

export type CorrelationData = { symbols: string[]; matrix: number[][] }
export async function getAssistantCorrelation(token: string, portfolioId = 'default'): Promise<CorrelationData> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/correlation?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return { symbols: [], matrix: [] }
  return res.json()
}

export type SentimentHeadline = {
  title: string
  source: string
  url: string
  published_at: string
  sentiment_score: number
}

export type SentimentRow = {
  symbol: string
  news_count: number
  avg_sentiment: number
  bullish_count: number
  bearish_count: number
  neutral_count: number
  sentiment_label: string
  headlines: SentimentHeadline[]
}

export async function getAssistantSentiment(token: string, portfolioId = 'default'): Promise<SentimentRow[]> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/sentiment?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

export type AISignalRow = {
  symbol: string
  avg_price: number
  qty: number
  signal: string
  confidence: number
  score: number
  entry_price: number
  stop_loss: number
  targets: number[]
  news_score: number
  social_score: number
  technical_score: number
  explanation: string
  holding_period: string
  risk_reward_ratio: number
  scanned_at: string | null
}

export async function getAssistantAISignals(token: string, portfolioId = 'default'): Promise<AISignalRow[]> {
  const res = await fetch(
    `${BASE}/api/v1/portfolio/assistant/ai-signals?portfolio_id=${encodeURIComponent(portfolioId)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export type AlertRule = {
  id: string
  symbol: string
  price_target: number
  direction: 'above' | 'below'
  triggered: boolean
  triggered_at: string | null
  triggered_price: number | null
  created_at: string
}

export async function listAlerts(token: string): Promise<AlertRule[]> {
  const res = await fetch(`${BASE}/api/v1/alerts`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch alerts')
  return res.json()
}

export async function createAlert(
  token: string,
  symbol: string,
  price_target: number,
  direction: 'above' | 'below',
): Promise<AlertRule> {
  const res = await fetch(`${BASE}/api/v1/alerts`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, price_target, direction }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to create alert')
  }
  return res.json()
}

export async function deleteAlert(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/alerts/${id}`, { method: 'DELETE', headers: authHeaders(token) })
}

export async function checkAlerts(token: string): Promise<AlertRule[]> {
  const res = await fetch(`${BASE}/api/v1/alerts/check`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) return []
  return res.json()
}

export type PositionAlert = {
  id: string
  trade_id: string
  symbol: string
  signal: 'BUY' | 'SELL'
  event: 'stop_hit' | 'target_hit'
  entry_price: number
  stop_loss: number
  target: number
  trigger_price: number
  quantity: number
  pnl_estimate: number
  triggered_at: string
  acknowledged: boolean
}

export async function listPositionAlerts(token: string): Promise<PositionAlert[]> {
  const res = await fetch(`${BASE}/api/v1/alerts/positions`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function ackPositionAlert(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/alerts/positions/${id}/ack`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}

export async function clearPositionAlert(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/alerts/positions/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

// ── Trade Journal ──────────────────────────────────────────────────────────

export type JournalEntry = {
  trade_id: string
  notes: string
  rating: number
  tags: string[]
  created_at: string
  updated_at: string
}

export async function getJournalEntry(token: string, tradeId: string): Promise<JournalEntry | null> {
  const res = await fetch(`${BASE}/api/v1/journal/${tradeId}`, { headers: authHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch journal entry')
  return res.json()
}

export async function saveJournalEntry(
  token: string,
  tradeId: string,
  notes: string,
  rating: number,
  tags: string[],
): Promise<JournalEntry> {
  const res = await fetch(`${BASE}/api/v1/journal/${tradeId}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, rating, tags }),
  })
  if (!res.ok) throw new Error('Failed to save journal entry')
  return res.json()
}

// ── Legacy ──────────────────────────────────────────────────────────────────

export async function seedDefaultWatchlist(token: string): Promise<{ added: number }> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlist/seed-defaults`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Failed to seed defaults')
  return res.json()
}

export async function getWatchlist(token: string): Promise<WatchlistItem[]> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlist`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Failed to fetch watchlist')
  return res.json()
}

export async function addToWatchlist(token: string, symbol: string): Promise<WatchlistItem> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlist`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Failed to add symbol')
  }
  return res.json()
}

export async function removeFromWatchlist(token: string, symbol: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/scanner/watchlist/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Failed to remove symbol')
  }
}

export type HistoryBar = {
  time: number   // Unix timestamp (seconds)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ChartPeriod = '1m' | '1D' | '5m' | '5D' | '15m' | '30m' | '45m' | '1W' | '1h' | '1M' | '3M' | '6M' | '1Y'

export async function getHistory(
  token: string,
  symbol: string,
  period: ChartPeriod = '1M',
): Promise<HistoryBar[]> {
  const res = await fetch(
    `${BASE}/api/v1/scanner/history/${encodeURIComponent(symbol)}?period=${period}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch history')
  }
  return res.json()
}

export async function getQuote(token: string, symbol: string): Promise<Quote> {
  const res = await fetch(`${BASE}/api/v1/scanner/quotes/${encodeURIComponent(symbol)}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(`Failed to fetch quote for ${symbol}`)
  return res.json()
}

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<{ id: string; email: string }> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name: fullName }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Registration failed')
  }
  return res.json()
}

export async function forgotPassword(email: string): Promise<{ message: string; reset_token?: string }> {
  const res = await fetch(`${BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error('Request failed')
  return res.json()
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Reset failed')
  }
}

export async function analyzeSymbol(token: string, symbol: string): Promise<AIRecommendation> {
  const res = await fetch(`${BASE}/api/v1/ai/analyze/${encodeURIComponent(symbol)}`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'AI analysis failed')
  }
  return res.json()
}

export async function analyzeBatch(token: string, symbols: string[]): Promise<AIRecommendation[]> {
  const res = await fetch(`${BASE}/api/v1/ai/analyze/batch`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Batch analysis failed')
  }
  return res.json()
}

export async function validateTrade(
  token: string,
  params: { signal: string; entry_price: number; stop_loss: number; target: number; quantity: number },
): Promise<RiskCheckResult> {
  const res = await fetch(`${BASE}/api/v1/risk/validate`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Validation request failed')
  return res.json()
}

export async function getRiskConfig(token: string): Promise<RiskConfig> {
  const res = await fetch(`${BASE}/api/v1/risk/config`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch risk config')
  return res.json()
}

export async function getRiskStatus(token: string): Promise<RiskStatus> {
  const res = await fetch(`${BASE}/api/v1/risk/status`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch risk status')
  return res.json()
}

export async function runBacktest(
  token: string,
  symbol: string,
  period: string,
  strategy: string,
): Promise<BacktestResult> {
  const res = await fetch(`${BASE}/api/v1/backtest/run`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, period, strategy }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Backtest failed')
  }
  return res.json()
}

export async function listTrades(token: string, status?: string): Promise<Trade[]> {
  const url = status
    ? `${BASE}/api/v1/paper/trades?status=${encodeURIComponent(status)}`
    : `${BASE}/api/v1/paper/trades`
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch trades')
  return res.json()
}

export async function placeTrade(token: string, body: PlaceTradeBody): Promise<Trade> {
  const res = await fetch(`${BASE}/api/v1/paper/trades`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to place trade')
  }
  return res.json()
}

// ── MCX Natural Gas ──────────────────────────────────────────────────────────

export type NgQuote = {
  tradingsymbol: string
  name: string
  expiry: string
  lot_size: number
  tick_size: number
  last_price: number
  open: number
  high: number
  low: number
  prev_close: number
  change: number
  change_pct: number
  volume: number
  oi: number
  oi_day_high: number
  oi_day_low: number
}

export type McxTrade = Trade & { lots: number }
export type McxContract = 'NG' | 'NGMINI'

export type PlaceNgTradeBody = {
  signal: 'BUY' | 'SELL'
  lots: number
  stop_loss: number
  target: number
  limit_price?: number
  contract?: McxContract
}

export async function getNgQuote(token: string, contract: McxContract = 'NG'): Promise<NgQuote> {
  const res = await fetch(`${BASE}/api/v1/mcx/ng/quote?contract=${contract}`, { headers: authHeaders(token) })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch MCX quote')
  }
  return res.json()
}

export async function listNgTrades(token: string, status?: string): Promise<McxTrade[]> {
  const url = status
    ? `${BASE}/api/v1/mcx/ng/trades?trade_status=${encodeURIComponent(status)}`
    : `${BASE}/api/v1/mcx/ng/trades`
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch MCX trades')
  return res.json()
}

export async function placeNgTrade(token: string, body: PlaceNgTradeBody): Promise<McxTrade> {
  const res = await fetch(`${BASE}/api/v1/mcx/ng/trades`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to place MCX trade')
  }
  return res.json()
}

export async function closeNgTrade(token: string, tradeId: string, exitPrice?: number): Promise<McxTrade> {
  const url = exitPrice != null
    ? `${BASE}/api/v1/mcx/ng/trades/${tradeId}/close?exit_price=${exitPrice}`
    : `${BASE}/api/v1/mcx/ng/trades/${tradeId}/close`
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token) })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to close MCX trade')
  }
  return res.json()
}

export async function getNgHistory(
  token: string,
  period: ChartPeriod = '1D',
  contract: McxContract = 'NG',
): Promise<HistoryBar[]> {
  const res = await fetch(
    `${BASE}/api/v1/mcx/ng/history?period=${period}&contract=${contract}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch MCX history')
  }
  return res.json()
}

export type NgRangeStats = {
  contract: string
  day_high: number
  day_low: number
  week_high: number
  week_low: number
  month_high: number
  month_low: number
}

export async function getNgRangeStats(token: string, contract: McxContract = 'NG'): Promise<NgRangeStats> {
  const res = await fetch(`${BASE}/api/v1/mcx/ng/range-stats?contract=${contract}`, { headers: authHeaders(token) })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch MCX range stats')
  }
  return res.json()
}

export type NgPredictedPoint = { time: number; predicted_close: number; upper: number; lower: number }
export type NgPredictionHistoryPoint = NgPredictedPoint & { actual_close: number | null; hit: boolean | null }
export type NgPredictionAccuracy = { sample_size: number; hit_rate_pct: number | null; avg_error_pct: number | null }
export type NgPrediction = {
  contract: string
  period: string
  generated_at?: string
  last_actual_time?: number
  last_actual_close?: number
  predicted: NgPredictedPoint[]
  history: NgPredictionHistoryPoint[]
  accuracy: NgPredictionAccuracy
  method: string
  note?: string
}

export async function getNgPrediction(
  token: string,
  contract: McxContract = 'NG',
  period: ChartPeriod = '15m',
): Promise<NgPrediction> {
  const res = await fetch(
    `${BASE}/api/v1/mcx/ng/predict?period=${period}&contract=${contract}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch MCX prediction')
  }
  return res.json()
}

export type TrendState = 'STABLE' | 'WEAKENING' | 'JUST_CHANGED'
export type TrendTimeframe = {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN'
  strength: number
  reason?: string
  change_state?: TrendState
  adx?: number | null
}
export type NgTrendLadder = {
  contract: string
  tradingsymbol: string
  computed_at: string
  ladder: Record<string, TrendTimeframe>
}

export async function getNgTrend(token: string, contract: McxContract = 'NG'): Promise<NgTrendLadder> {
  const res = await fetch(`${BASE}/api/v1/mcx/ng/trend?contract=${contract}`, { headers: authHeaders(token) })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch MCX trend')
  }
  return res.json()
}

// ── MCX NG-AI Pro v1 score ───────────────────────────────────────────────────

export type NgScoreCheck = { label: string; passed: boolean; points: number; max: number; note: string }
export type NgScoreCategory = {
  name: string
  weight: number
  earned: number
  available: number
  checks: NgScoreCheck[]
  excluded: string[]
}
export type NgAiScore = {
  contract: string
  tradingsymbol: string
  direction: 'BUY' | 'SELL'
  price: number
  score_pct: number
  verdict: 'TRADE' | 'WATCHLIST' | 'NO_TRADE'
  points_earned: number
  points_available: number
  points_nominal_total: number
  categories: NgScoreCategory[]
  entry: {
    entry_price: number
    stop_loss: number
    stop_loss_distance: number
    target_1: number
    target_1_pct_of_position: number
    target_2: number
    target_2_pct_of_position: number
    trail_remainder_note: string
  }
  position_sizing: {
    capital: number
    risk_pct: number
    risk_amount: number
    lot_size: number
    one_lot_risk: number | null
    suggested_lots: number
    note: string | null
  }
  risk_rules: {
    max_trades_per_day: number
    stop_after_consecutive_losses: number
    daily_loss_limit_pct: number
    daily_profit_target_pct: string
    never_average_down: boolean
  }
  candles_used: number
  correlation_inputs: Record<string, number | null>
}

export async function getNgAiScore(
  token: string,
  direction: 'BUY' | 'SELL' = 'BUY',
  capital = 100000,
  contract: McxContract = 'NG',
): Promise<NgAiScore> {
  const res = await fetch(
    `${BASE}/api/v1/mcx/ng/ai-score?direction=${direction}&capital=${capital}&contract=${contract}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to fetch AI score')
  }
  return res.json()
}

// ── Phase 3: Broker ────────────────────────────────────────────────────────

export async function getBrokerStatus(token: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/status`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch broker status')
  return res.json()
}

export async function getZerodhaLoginUrl(token: string): Promise<{ login_url: string }> {
  const res = await fetch(`${BASE}/api/v1/broker/zerodha/login-url`, { headers: authHeaders(token) })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Failed') }
  return res.json()
}

export async function connectZerodha(token: string, request_token: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/zerodha/connect`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_token }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Connect failed') }
  return res.json()
}

export async function disconnectBroker(token: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/disconnect`, { method: 'POST', headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to disconnect')
  return res.json()
}

export async function activateSimulatedBroker(token: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/use-simulated`, { method: 'POST', headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed')
  return res.json()
}

export async function getUpstoxLoginUrl(token: string): Promise<{ login_url: string; redirect_uri: string }> {
  const res = await fetch(`${BASE}/api/v1/broker/upstox/login-url`, { headers: authHeaders(token) })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Failed') }
  return res.json()
}

export async function connectUpstox(token: string, code: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/upstox/connect`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Connect failed') }
  return res.json()
}

export async function getBrokerPositions(token: string): Promise<BrokerPosition[]> {
  const res = await fetch(`${BASE}/api/v1/broker/positions`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

// ── Phase 3: Live Trading ───────────────────────────────────────────────────

export async function placeLiveOrder(token: string, body: {
  symbol: string; signal: string; quantity: number; order_type: string;
  price?: number; stop_loss?: number; target?: number;
}): Promise<LiveOrder> {
  const res = await fetch(`${BASE}/api/v1/live/orders`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Order failed') }
  return res.json()
}

export async function listLiveOrders(token: string): Promise<LiveOrder[]> {
  const res = await fetch(`${BASE}/api/v1/live/orders`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch orders')
  return res.json()
}

export async function cancelLiveOrder(token: string, brokerOrderId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/live/orders/${encodeURIComponent(brokerOrderId)}`, {
    method: 'DELETE', headers: authHeaders(token),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Cancel failed') }
}

export async function getLivePositions(token: string): Promise<LivePosition[]> {
  const res = await fetch(`${BASE}/api/v1/live/positions`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to fetch positions')
  return res.json()
}

// ── Phase 4: ML ────────────────────────────────────────────────────────────

export async function predictBatch(token: string, symbols: string[]): Promise<MLPrediction[]> {
  const res = await fetch(`${BASE}/api/v1/ml/predict/batch`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Prediction failed') }
  return res.json()
}

// ── Phase 4: Admin ──────────────────────────────────────────────────────────

export async function getAdminStats(token: string): Promise<AdminStats> {
  const res = await fetch(`${BASE}/api/v1/admin/stats`, { headers: authHeaders(token) })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Forbidden') }
  return res.json()
}

export async function listAdminUsers(token: string): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/api/v1/admin/users`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Forbidden')
  return res.json()
}

export async function updateAdminUser(
  token: string, userId: string, body: { role?: string; is_active?: boolean }
): Promise<AdminUser> {
  const res = await fetch(`${BASE}/api/v1/admin/users/${userId}`, {
    method: 'PATCH', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Update failed') }
  return res.json()
}

export async function createAdminUser(
  token: string, body: { email: string; full_name: string; password: string; role: string }
): Promise<AdminUser> {
  const res = await fetch(`${BASE}/api/v1/admin/users`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Create failed') }
  return res.json()
}

export async function listEmailRecipients(token: string): Promise<EmailRecipient[]> {
  const res = await fetch(`${BASE}/api/v1/admin/email-list`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed to load email list')
  return res.json()
}

export async function addEmailRecipient(
  token: string, email: string, label: string
): Promise<EmailRecipient> {
  const res = await fetch(`${BASE}/api/v1/admin/email-list`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, label }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Add failed') }
  return res.json()
}

export async function removeEmailRecipient(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/admin/email-list/${id}`, {
    method: 'DELETE', headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Remove failed')
}

export async function toggleEmailRecipient(token: string, id: string): Promise<EmailRecipient> {
  const res = await fetch(`${BASE}/api/v1/admin/email-list/${id}/toggle`, {
    method: 'PATCH', headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Toggle failed')
  return res.json()
}

// ── Market Pulse ───────────────────────────────────────────────────────────

export async function getMarketPulse(
  token: string,
  sector: string = 'all',
  buyCount: number = 10,
  sellCount: number = 5,
): Promise<MarketPulseResult> {
  const params = new URLSearchParams({ sector, buy_count: String(buyCount), sell_count: String(sellCount) })
  const res = await fetch(`${BASE}/api/v1/market-pulse/scan?${params}`, { headers: authHeaders(token) })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Scan failed') }
  return res.json()
}

// ── Research Agent ─────────────────────────────────────────────────────────

export async function marketScan(
  token: string,
  filter: string = 'both',
  universe: string = 'nifty50',
  limit: number = 20,
): Promise<ScanResult[]> {
  const url = `${BASE}/api/v1/research/scan?filter_type=${filter}&universe=${universe}&limit=${limit}`
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Scan failed') }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────

export async function cancelTrade(token: string, tradeId: string): Promise<Trade> {
  const res = await fetch(`${BASE}/api/v1/paper/trades/${tradeId}/cancel`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function closeTrade(token: string, tradeId: string, exitPrice?: number): Promise<Trade> {
  const qs = exitPrice != null ? `?exit_price=${exitPrice}` : ''
  const res = await fetch(`${BASE}/api/v1/paper/trades/${tradeId}/close${qs}`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to close trade')
  }
  return res.json()
}

// ── Auth profile ──────────────────────────────────────────────────────────────

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { detail?: string }).detail ?? 'Failed to change password')
  }
}

export async function updateProfile(token: string, fullName: string): Promise<User> {
  const res = await fetch(`${BASE}/api/v1/auth/me`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!res.ok) throw new Error('Failed to update profile')
  return res.json()
}

// ── Risk config ───────────────────────────────────────────────────────────────

export async function updateRiskConfig(
  token: string,
  patch: Partial<RiskConfig>,
): Promise<RiskConfig> {
  const res = await fetch(`${BASE}/api/v1/risk/config`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update risk config')
  return res.json()
}

// ── Stock search ──────────────────────────────────────────────────────────────

export type StockSearchResult = {
  symbol: string
  name: string
  sector: string
  exchange: string
}

// ── AI signal history ─────────────────────────────────────────────────────────

export type AISignalRecord = {
  id: string
  symbol: string
  signal: string
  confidence: number
  entry_price: number
  stop_loss: number
  target: number
  risk_reward_ratio: number
  holding_period: string
  explanation: string
  engine: string
  created_at: string
}

export async function getAIHistory(
  token: string,
  symbol?: string,
  limit = 50,
): Promise<AISignalRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (symbol) params.set('symbol', symbol)
  const res = await fetch(`${BASE}/api/v1/ai/history?${params}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return []
  return res.json()
}

export async function searchStocks(
  token: string,
  q: string,
): Promise<StockSearchResult[]> {
  if (q.trim().length < 2) return []
  const res = await fetch(
    `${BASE}/api/v1/scanner/search?q=${encodeURIComponent(q)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

// ── API Keys ─────────────────────────────────────────────────────────────────

export type ApiKey = {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}

export type CreatedApiKey = ApiKey & { raw_key: string }

export async function createApiKey(token: string, name: string): Promise<CreatedApiKey> {
  const res = await fetch(`${BASE}/api/v1/auth/api-keys`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listApiKeys(token: string): Promise<ApiKey[]> {
  const res = await fetch(`${BASE}/api/v1/auth/api-keys`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function revokeApiKey(token: string, keyId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/auth/api-keys/${keyId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!res.ok && res.status !== 204) throw new Error(await res.text())
}

// ── Usage metering ───────────────────────────────────────────────────────────

export type UsageInfo = {
  tier: string
  calls_today: number
  limit: number
  remaining: number
}

export async function getUsage(token: string): Promise<UsageInfo> {
  const res = await fetch(`${BASE}/api/v1/usage/me`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Ensemble signal ──────────────────────────────────────────────────────────

export type EnsembleSignal = {
  symbol: string
  consensus: {
    signal: 'BUY' | 'SELL' | 'HOLD'
    confidence: number
    entry_price: number
    stop_loss: number
    target: number
    risk_reward_ratio: number
    holding_period: string
    explanation: string
  }
  engines: {
    local?: {
      signal: string
      confidence: number
      entry_price: number
      stop_loss: number
      target: number
      explanation: string
    }
    ml?: {
      prediction: string
      probability: number
      accuracy_cv: number
      top_features: Record<string, number>
    }
    claude?: {
      signal: string
      confidence: number
      explanation: string
    }
  }
}

// ── Discovery Engine ─────────────────────────────────────────────────────────

export type StockScore = {
  id: string
  symbol: string
  name: string
  score: number
  signal: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL'
  confidence: number
  entry_price: number
  stop_loss: number
  targets: number[]
  holding_period: string
  risk_reward_ratio: number
  technical_score: number
  news_score: number
  ml_score: number
  social_score: number
  patterns: string[]
  explanation: string
  scanned_at: string
  sector: string
}

export type DiscoveryStatus = {
  last_scan_at: string | null
  next_scan_at: string | null
  stocks_scanned: number
  is_running: boolean
  scheduler_active: boolean
  universe_size: number
  social_providers: Record<string, boolean>
}

export type DiscoveryNewsItem = {
  id: string
  title: string
  source: string
  url: string
  published_at: string
  sentiment_score: number
  mentioned_symbols: string[]
  summary: string
}

export async function getTopPicks(
  token: string,
  limit = 20,
  signal?: string,
  minScore = 0,
): Promise<StockScore[]> {
  const params = new URLSearchParams({ limit: String(limit), min_score: String(minScore) })
  if (signal) params.set('signal', signal)
  const res = await fetch(`${BASE}/api/v1/discovery/top-picks?${params}`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getDiscoveryStatus(token: string): Promise<DiscoveryStatus> {
  const res = await fetch(`${BASE}/api/v1/discovery/status`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getDiscoveryNews(
  token: string,
  symbol?: string,
  limit = 50,
): Promise<DiscoveryNewsItem[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (symbol) params.set('symbol', symbol)
  const res = await fetch(`${BASE}/api/v1/discovery/news?${params}`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function triggerDiscoveryScan(
  token: string,
): Promise<{ message: string; started: boolean }> {
  const res = await fetch(`${BASE}/api/v1/discovery/scan`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Report History ─────────────────────────────────────────────────────────

export type ReportSummary = {
  id: string
  generated_at: string
  scanned_count: number
  picks_count: number
  signal_summary: Record<string, number>
}

export type ReportPick = {
  symbol: string
  name: string
  signal: string
  score: number
  entry_price: number
  stop_loss: number
  targets: number[]
  target: number | null
  risk_reward_ratio: number
  holding_period: string
  patterns: string[]
  confidence: number
}

export type ReportDetail = ReportSummary & { picks: ReportPick[] }

export type PerformancePick = ReportPick & {
  targets: number[]
  target_pcts: number[]
  current_price: number | null
  pnl_pct: number | null
  status: 'TARGET_HIT' | 'STOP_HIT' | 'ABOVE_ENTRY' | 'BELOW_ENTRY' | 'AT_ENTRY' | 'NO_DATA'
}

export type ReportPerformance = {
  id: string
  generated_at: string
  scanned_count: number
  picks: PerformancePick[]
}

export async function listReportHistory(
  token: string,
  limit = 30,
  skip = 0,
  fromDate?: string,
  toDate?: string,
): Promise<ReportSummary[]> {
  const params = new URLSearchParams({ limit: String(limit), skip: String(skip) })
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  const res = await fetch(`${BASE}/api/v1/discovery/reports?${params}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return []
  return res.json()
}

export async function countReports(token: string, fromDate?: string, toDate?: string): Promise<number> {
  const params = new URLSearchParams()
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  const res = await fetch(`${BASE}/api/v1/discovery/reports/count?${params}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return 0
  const d = await res.json()
  return d.total ?? 0
}

export async function getReportDetail(token: string, reportId: string): Promise<ReportDetail | null> {
  const res = await fetch(`${BASE}/api/v1/discovery/reports/${reportId}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return null
  return res.json()
}

export async function getReportPerformance(token: string, reportId: string): Promise<ReportPerformance | null> {
  const res = await fetch(`${BASE}/api/v1/discovery/reports/${reportId}/performance`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return null
  return res.json()
}

export async function sendReportNow(token: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/api/v1/discovery/send-report`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getEnsembleSignal(token: string, symbol: string): Promise<EnsembleSignal> {
  const res = await fetch(`${BASE}/api/v1/ai/ensemble/${encodeURIComponent(symbol)}`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Forecast types ────────────────────────────────────────────────────────────

export type ModelForecast = {
  model: string
  predicted_price: number
  change_pct: number
  confidence: number
  direction: 'UP' | 'DOWN' | 'FLAT'
}

export type HorizonForecast = {
  horizon: string
  horizon_days: number
  target_date: string
  ensemble_price: number
  ensemble_change_pct: number
  lower_bound: number
  upper_bound: number
  direction: 'UP' | 'DOWN' | 'FLAT'
  models: ModelForecast[]
}

export type ForecastResult = {
  id: string
  symbol: string
  name: string
  current_price: number
  prev_close: number
  day_change_pct: number
  week_change_pct: number
  high_52w: number
  low_52w: number
  volume: number
  avg_volume: number
  forecasts: HorizonForecast[]
  agent_analysis: string
  generated_at: string
}

export type ForecastAccuracyRecord = {
  symbol: string
  horizon: string
  model: string
  predicted_price: number
  predicted_change_pct: number
  direction: string
  base_price: number
  target_date: string
  generated_at: string
  actual_price: number | null
  error_pct: number | null
  direction_correct: boolean | null
}

export async function getForecast(token: string, symbol: string): Promise<ForecastResult> {
  const res = await fetch(`${BASE}/api/v1/forecast/${encodeURIComponent(symbol)}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Dashboard market overview ─────────────────────────────────────────────────

export type IndexQuote = {
  symbol: string
  name: string
  price: number
  change: number
  change_pct: number
  high: number
  low: number
}

export type EconomicEvent = {
  date: string
  event: string
  category: 'rbi' | 'market' | 'results' | 'budget'
}

export type MarketOverviewData = {
  indices: IndexQuote[]
  global: IndexQuote[]
  economic_events: EconomicEvent[]
  fetched_at: number
}

export async function getMarketOverview(token: string): Promise<MarketOverviewData> {
  const res = await fetch(`${BASE}/api/v1/dashboard/market-overview`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Market Scanner ────────────────────────────────────────────────────────────

export type ScanCatalogItem = {
  id: string
  name: string
  category: string
  available: boolean
  desc: string
}

export type ScanResultItem = {
  symbol: string
  name: string
  sector: string
  cmp: number
  change_pct: number
  volume: number
  vol_ratio: number
  rsi: number
  key_metric: string
  signal: string
}

export type ScanResponse = {
  scan_id: string
  name: string
  results: ScanResultItem[]
  count: number
  available: boolean
  note: string | null
  universe?: number
  scanned_at: number | null
  cached: boolean
}

export async function getScanCatalog(token: string): Promise<ScanCatalogItem[]> {
  const res = await fetch(`${BASE}/api/v1/scanner/scan-catalog`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function runMarketScan(token: string, scanType: string, limit = 25): Promise<ScanResponse> {
  const res = await fetch(
    `${BASE}/api/v1/scanner/market-scan?scan_type=${encodeURIComponent(scanType)}&limit=${limit}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getForecastHistory(
  token: string,
  symbol: string,
  horizon?: string,
  limit = 30,
): Promise<ForecastAccuracyRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (horizon) params.set('horizon', horizon)
  const res = await fetch(
    `${BASE}/api/v1/forecast/${encodeURIComponent(symbol)}/history?${params}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Stock of the Day ──────────────────────────────────────────────────────────

export type StockOfDay = {
  id: string | null
  date: string
  generated_at: string
  symbol: string
  name: string
  sector: string
  discovery_score: number
  discovery_signal: string
  scanner_hits: string[]
  forecast_direction: string
  composite_score: number
  confidence: number
  entry_price: number
  stop_loss: number
  target: number
  risk_reward: number
  holding_period: string
  explanation: string
  auto_traded: boolean
  paper_trade_id: string | null
  quantity: number
  status: 'WATCHING' | 'TRADING' | 'TARGET_HIT' | 'STOP_HIT' | 'EXPIRED'
  exit_price: number | null
  exit_time: string | null
  pnl_pct: number | null
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL' | null
}

export type SotDJournalEntry = {
  _id: string
  date: string
  event: string
  details: Record<string, unknown>
  logged_at: string
}

export async function getSotDToday(token: string): Promise<{ data: StockOfDay | null; today: string }> {
  const res = await fetch(`${BASE}/api/v1/stock-of-day/today`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSotDHistory(token: string, limit = 30): Promise<StockOfDay[]> {
  const res = await fetch(
    `${BASE}/api/v1/stock-of-day/history?limit=${limit}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSotDJournal(token: string, dateStr: string): Promise<SotDJournalEntry[]> {
  const res = await fetch(
    `${BASE}/api/v1/stock-of-day/journal/${encodeURIComponent(dateStr)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

export async function triggerSotDGenerate(token: string): Promise<StockOfDay> {
  const res = await fetch(`${BASE}/api/v1/stock-of-day/generate`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export type SotDSettings = {
  auto_trade_enabled: boolean
  threshold: number
  max_daily_trades: number
  market_hours_only: boolean
  paper_trade_quantity: number
  quantity_type: 'qty' | 'pct'
  paper_capital: number
}

export async function getSotDSettings(token: string): Promise<SotDSettings> {
  const res = await fetch(`${BASE}/api/v1/stock-of-day/settings`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateSotDSettings(token: string, cfg: SotDSettings): Promise<SotDSettings> {
  const res = await fetch(`${BASE}/api/v1/stock-of-day/settings`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Phase 5: Strategy Builder ─────────────────────────────────────────────────

export type StrategyCondition = {
  indicator: string
  operator: string
  value: number
}

export type Strategy = {
  id: string
  name: string
  user_id: string
  action: 'BUY' | 'SELL'
  conditions: StrategyCondition[]
  description: string
  is_active: boolean
  created_at: string
}

export type StrategyMeta = {
  indicators: string[]
  operators: string[]
}

export type StrategyBacktestResult = {
  symbol: string
  strategy_name: string
  action: string
  period: string
  total_trades: number
  winners: number
  losers: number
  win_rate_pct: number
  total_return_pct: number
  max_drawdown_pct: number
  sharpe_ratio: number
  trades: { date_in: string; date_out: string; signal: string; entry: number; exit: number; pnl: number; pnl_pct: number }[]
  equity_curve: { date: string; value: number }[]
}

export async function getStrategyMeta(token: string): Promise<StrategyMeta> {
  const res = await fetch(`${BASE}/api/v1/strategy/meta`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listStrategies(token: string): Promise<Strategy[]> {
  const res = await fetch(`${BASE}/api/v1/strategy`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createStrategy(token: string, body: {
  name: string; action: string; conditions: StrategyCondition[]; description?: string
}): Promise<Strategy> {
  const res = await fetch(`${BASE}/api/v1/strategy`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Create failed') }
  return res.json()
}

export async function deleteStrategy(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/strategy/${id}`, { method: 'DELETE', headers: authHeaders(token) })
}

export async function toggleStrategy(token: string, id: string): Promise<Strategy> {
  const res = await fetch(`${BASE}/api/v1/strategy/${id}/toggle`, {
    method: 'PATCH', headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function backtestStrategy(token: string, id: string, symbol: string, period = '1y'): Promise<StrategyBacktestResult> {
  const res = await fetch(`${BASE}/api/v1/strategy/${id}/backtest`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, period }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Backtest failed') }
  return res.json()
}

// ── Phase 5: Webhooks ─────────────────────────────────────────────────────────

export type WebhookSub = {
  id: string
  name: string
  url: string
  events: string[]
  secret: string
  is_active: boolean
  created_at: string
  last_triggered_at: string | null
  failure_count: number
}

export type WebhookDelivery = {
  webhook_id: string
  event: string
  status_code: number | null
  ok: boolean
  error: string
  delivered_at: string
}

export async function listWebhookEvents(token: string): Promise<string[]> {
  const res = await fetch(`${BASE}/api/v1/webhooks/events`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function listWebhooks(token: string): Promise<WebhookSub[]> {
  const res = await fetch(`${BASE}/api/v1/webhooks`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function createWebhook(token: string, body: { name: string; url: string; events: string[] }): Promise<WebhookSub> {
  const res = await fetch(`${BASE}/api/v1/webhooks`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Create failed') }
  return res.json()
}

export async function deleteWebhook(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/webhooks/${id}`, { method: 'DELETE', headers: authHeaders(token) })
}

export async function toggleWebhook(token: string, id: string): Promise<WebhookSub> {
  const res = await fetch(`${BASE}/api/v1/webhooks/${id}/toggle`, {
    method: 'PATCH', headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listWebhookDeliveries(token: string, id: string): Promise<WebhookDelivery[]> {
  const res = await fetch(`${BASE}/api/v1/webhooks/${id}/deliveries`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export type WebhookEventExample = { event: string; data: Record<string, unknown>; timestamp: string }

export async function getWebhookEventExample(token: string, event: string): Promise<WebhookEventExample> {
  const res = await fetch(`${BASE}/api/v1/webhooks/events/${encodeURIComponent(event)}/example`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export type WebhookTestResult = {
  event: string
  sample_payload: Record<string, unknown>
  status_code: number | null
  ok: boolean
  error: string
}

export async function testWebhook(token: string, id: string, event?: string): Promise<WebhookTestResult> {
  const res = await fetch(`${BASE}/api/v1/webhooks/${id}/test`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: event ?? null }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Test failed') }
  return res.json()
}

// ── Phase 5: WebSocket price streaming ───────────────────────────────────────

export type PriceTick = {
  symbol: string
  price: number | null
  change: number
  change_pct: number
  ok: boolean
}

export type PriceStreamMessage =
  | { type: 'tick'; data: PriceTick[] }
  | { type: 'subscribed'; symbols: string[] }
  | { type: 'unsubscribed' }
  | { type: 'pong' }

export function createPriceStream(token: string, onMessage: (msg: PriceStreamMessage) => void): {
  subscribe: (symbols: string[]) => void
  unsubscribe: () => void
  close: () => void
} {
  const wsBase = BASE.replace(/^http/, 'ws') || (typeof window !== 'undefined' ? `ws://${window.location.host}` : 'ws://localhost')
  const ws = new WebSocket(`${wsBase}/api/v1/ws/prices?token=${encodeURIComponent(token)}`)

  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch { /* ignore */ }
  }

  return {
    subscribe(symbols) {
      const send = () => ws.send(JSON.stringify({ action: 'subscribe', symbols }))
      if (ws.readyState === WebSocket.OPEN) send()
      else ws.addEventListener('open', send, { once: true })
    },
    unsubscribe() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'unsubscribe' }))
    },
    close() { ws.close() },
  }
}

// ── Phase 4: Organization / Multi-client SaaS ────────────────────────────────

export type OrgPlanLimits = {
  max_users: number
  max_capital: number
  live_trading: boolean
}

export type OrgData = {
  id: string
  name: string
  plan: 'free' | 'pro' | 'enterprise'
  is_active: boolean
  created_at: string
  member_count: number
  role: 'owner' | 'admin' | 'member'
  limits: OrgPlanLimits
}

export type OrgMember = {
  org_id: string
  user_id: string
  role: string
  joined_at: string
}

export type OrgInvite = {
  org_id: string
  email: string
  invited_by: string
  token: string
  accepted: boolean
  created_at: string
}

export async function getMyOrg(token: string): Promise<OrgData | null> {
  const res = await fetch(`${BASE}/api/v1/org/my`, { headers: authHeaders(token) })
  if (!res.ok) return null
  return res.json()
}

export async function createOrg(token: string, name: string, plan = 'free'): Promise<OrgData> {
  const res = await fetch(`${BASE}/api/v1/org`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, plan }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Create failed') }
  return res.json()
}

export async function listOrgMembers(token: string): Promise<OrgMember[]> {
  const res = await fetch(`${BASE}/api/v1/org/my/members`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function listOrgInvites(token: string): Promise<OrgInvite[]> {
  const res = await fetch(`${BASE}/api/v1/org/my/invites`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function inviteMember(token: string, email: string): Promise<{ email: string; invite_token: string; message: string }> {
  const res = await fetch(`${BASE}/api/v1/org/my/invite`, {
    method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Invite failed') }
  return res.json()
}

export async function revokeInvite(token: string, email: string): Promise<void> {
  await fetch(`${BASE}/api/v1/org/my/invite/${encodeURIComponent(email)}`, {
    method: 'DELETE', headers: authHeaders(token),
  })
}

export async function acceptInvite(token: string, inviteToken: string): Promise<{ joined: boolean; org_id: string }> {
  const res = await fetch(`${BASE}/api/v1/org/accept-invite?token=${encodeURIComponent(inviteToken)}`, {
    method: 'POST', headers: authHeaders(token),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Accept failed') }
  return res.json()
}

export async function updateOrgPlan(token: string, plan: string): Promise<OrgData> {
  const res = await fetch(`${BASE}/api/v1/org/my/plan`, {
    method: 'PATCH', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Update failed') }
  return res.json()
}

export async function listAllOrgs(token: string): Promise<OrgData[]> {
  const res = await fetch(`${BASE}/api/v1/org/admin/all`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function adminSetOrgPlan(token: string, orgId: string, plan: string): Promise<OrgData> {
  const res = await fetch(`${BASE}/api/v1/org/admin/${orgId}/plan`, {
    method: 'PATCH', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Update failed') }
  return res.json()
}

// ── Market Data Sources ───────────────────────────────────────────────────────

export type MarketSourceInfo = {
  id: string
  name: string
  description: string
  url: string
  priority: number | null
  coverage: string
  delay: string
  official: boolean
  news_only?: boolean
}

export type SourceHealthEntry = {
  source: string
  success: number
  failure: number
  healthy: boolean
  last_error: string
}

export type SourceCompareResult = {
  source: string
  ok: boolean
  price?: number
  change_pct?: number
  volume?: number
  exchange?: string
  error?: string
}

export type MultiSourceQuote = {
  symbol: string
  sources: SourceCompareResult[]
}

export async function getMarketSources(token: string): Promise<MarketSourceInfo[]> {
  const res = await fetch(`${BASE}/api/v1/market-data/sources/list`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSourceHealth(token: string): Promise<SourceHealthEntry[]> {
  const res = await fetch(`${BASE}/api/v1/market-data/sources/health`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function compareQuoteSources(token: string, symbol: string): Promise<MultiSourceQuote> {
  const res = await fetch(
    `${BASE}/api/v1/market-data/sources/compare?symbol=${encodeURIComponent(symbol)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Phase 6: Notifications ────────────────────────────────────────────────────

export type AppNotification = {
  id: string
  type: string
  title: string
  body: string
  link: string
  read: boolean
  created_at: string
}

export async function listNotifications(token: string): Promise<AppNotification[]> {
  const res = await fetch(`${BASE}/api/v1/notifications`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function getUnreadCount(token: string): Promise<number> {
  const res = await fetch(`${BASE}/api/v1/notifications/unread-count`, { headers: authHeaders(token) })
  if (!res.ok) return 0
  const data = await res.json()
  return data.count ?? 0
}

export async function markNotificationRead(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/notifications/${id}/read`, {
    method: 'PATCH', headers: authHeaders(token),
  })
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  await fetch(`${BASE}/api/v1/notifications/read-all`, {
    method: 'POST', headers: authHeaders(token),
  })
}

export async function clearNotifications(token: string): Promise<void> {
  await fetch(`${BASE}/api/v1/notifications/clear`, {
    method: 'DELETE', headers: authHeaders(token),
  })
}

// ── Phase 6: Tax Report ───────────────────────────────────────────────────────

export type TaxTrade = {
  symbol: string
  signal: string
  entry_price: number
  exit_price: number
  quantity: number
  pnl: number
  holding_days: number
  category: 'STCG' | 'LTCG'
  opened_at: string | null
  closed_at: string | null
  mode: string
}

export type TaxSummarySection = {
  gain: number
  loss: number
  net: number
  tax_rate_pct: number
  estimated_tax: number
  exemption?: number
  taxable?: number
}

export type TaxReport = {
  fy: string
  mode: string
  total_trades: number
  summary: {
    stcg: TaxSummarySection
    ltcg: TaxSummarySection
    total_pnl: number
    estimated_total_tax: number
  }
  trades: TaxTrade[]
}

export async function getTaxReport(token: string, fy: string, mode: string): Promise<TaxReport> {
  const res = await fetch(
    `${BASE}/api/v1/tax/report?fy=${encodeURIComponent(fy)}&mode=${encodeURIComponent(mode)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function exportTaxCsv(token: string, fy: string, mode: string): void {
  const url = `${BASE}/api/v1/tax/export?fy=${encodeURIComponent(fy)}&mode=${encodeURIComponent(mode)}`
  const a = document.createElement('a')
  a.href = url
  a.setAttribute('data-auth', token)
  // Download with auth header isn't directly possible; open in new tab
  // The endpoint falls back gracefully without auth (returns 401 which browser shows)
  // For simplicity, trigger via fetch + blob
  fetch(url, { headers: authHeaders(token) })
    .then(r => r.blob())
    .then(blob => {
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `mts_tax_${fy}_${mode}.csv`
      link.click()
      URL.revokeObjectURL(href)
    })
    .catch(() => {})
}

// ── Phase 7: Options Chain ────────────────────────────────────────────────────

export type OptionsRow = {
  strike: number
  last_price: number
  bid: number | null
  ask: number | null
  volume: number
  open_interest: number
  iv: number | null
  delta: number | null
  change_pct: number
  in_the_money: boolean
}

export type OptionsChain = {
  symbol: string
  expiry: string
  spot: number | null
  atm_strike: number | null
  pcr: number | null
  max_pain: number | null
  total_call_oi: number
  total_put_oi: number
  calls: OptionsRow[]
  puts: OptionsRow[]
}

export async function getOptionsExpiries(token: string, symbol: string): Promise<string[]> {
  const res = await fetch(
    `${BASE}/api/v1/options/${encodeURIComponent(symbol)}/expiries`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Failed to load expiries') }
  return res.json()
}

export async function getOptionsChain(token: string, symbol: string, expiry: string): Promise<OptionsChain> {
  const res = await fetch(
    `${BASE}/api/v1/options/${encodeURIComponent(symbol)}/chain?expiry=${encodeURIComponent(expiry)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Failed to load chain') }
  return res.json()
}

// ── Phase 7: Economic Calendar ────────────────────────────────────────────────

export type CalendarEvent = {
  id: string
  date: string
  title: string
  description: string
  type: string
  impact: string
  symbol?: string
}

export async function getCalendarEvents(token: string, fromDate: string, toDate: string): Promise<CalendarEvent[]> {
  const res = await fetch(
    `${BASE}/api/v1/calendar/events?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
    { headers: authHeaders(token) },
  )
  if (!res.ok) return []
  return res.json()
}

// ── Phase 7: Custom Screener ──────────────────────────────────────────────────

export type ScreenerCriterion = {
  field: string
  operator: string
  value: number
}

export type ScreenerMeta = {
  fields: string[]
  operators: string[]
  universes: string[]
}

export type ScreenResult = {
  symbol: string
  name: string
  price: number
  change_pct: number
  rsi: number
  macd_hist: number
  sma20_ratio: number
  sma50_ratio: number
  volume_ratio: number
  atr_pct: number
  pe_ratio: number | null
  pb_ratio: number | null
  market_cap_cr: number | null
  dividend_yield: number | null
  roe: number | null
  debt_to_equity: number | null
  revenue_growth: number | null
}

export type SavedScreen = {
  id: string
  name: string
  universe: string
  criteria: ScreenerCriterion[]
  created_at: string
}

export async function getScreenerMeta(token: string): Promise<ScreenerMeta> {
  const res = await fetch(`${BASE}/api/v1/screener/meta`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function runScreen(
  token: string,
  body: { universe: string; criteria: ScreenerCriterion[]; limit?: number },
): Promise<{ total_scanned: number; matches: number; results: ScreenResult[] }> {
  const res = await fetch(`${BASE}/api/v1/screener/run`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Screen failed') }
  return res.json()
}

export async function listSavedScreens(token: string): Promise<SavedScreen[]> {
  const res = await fetch(`${BASE}/api/v1/screener/saved`, { headers: authHeaders(token) })
  if (!res.ok) return []
  return res.json()
}

export async function saveScreen(
  token: string,
  body: { name: string; universe: string; criteria: ScreenerCriterion[] },
): Promise<SavedScreen> {
  const res = await fetch(`${BASE}/api/v1/screener/saved`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { detail?: string }).detail ?? 'Save failed') }
  return res.json()
}

export async function deleteSavedScreen(token: string, id: string): Promise<void> {
  await fetch(`${BASE}/api/v1/screener/saved/${id}`, { method: 'DELETE', headers: authHeaders(token) })
}

// ── Phase 6: Audit Log ────────────────────────────────────────────────────────

export type AuditEvent = {
  id: string
  user_id: string
  action: string
  resource: string
  details: Record<string, string>
  ip: string
  created_at: string
}

export type AuditPage = {
  total: number
  events: AuditEvent[]
}

export async function listAuditLog(
  token: string,
  params: { user_id?: string; action?: string; limit?: number; skip?: number } = {},
): Promise<AuditPage> {
  const q = new URLSearchParams()
  if (params.user_id) q.set('user_id', params.user_id)
  if (params.action) q.set('action', params.action)
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  if (params.skip !== undefined) q.set('skip', String(params.skip))
  const res = await fetch(`${BASE}/api/v1/admin/audit?${q}`, { headers: authHeaders(token) })
  if (!res.ok) return { total: 0, events: [] }
  return res.json()
}

// ── Phase 8: Golden Stock — Intraday ─────────────────────────────────────────

export type BTSTCandidate = IntradayCandidate  // backward-compat alias
export type IntradayCandidate = {
  rank: number
  symbol: string
  name: string
  sector: string
  entry_price: number
  stop_loss: number
  target_1: number
  target_2: number
  risk_reward: number
  confidence_score: number
  fundamental_score: number
  technical_score: number
  momentum_score: number
  reasons: string[]
  current_price: number
  change_pct: number
  rsi: number
  adx: number
  volume_ratio: number
  macd_bullish: boolean
  near_day_high: boolean
  above_sma20: boolean
  above_sma50: boolean
  outcome?: string | null
  actual_close?: number | null
  actual_pct?: number | null
  resolved_at?: string | null
}

export type GoldenStockScan = {
  id?: string
  scan_date: string
  scan_time: string
  universe_scanned: number
  passed_filter: number
  picks: IntradayCandidate[]
  created_at?: string
}

export type GoldenStockHistoryItem = {
  id: string
  scan_date: string
  scan_time: string
  universe_scanned: number
  passed_filter: number
  pick_count: number
  top_symbol: string
  top_score: number
  created_at?: string
}

export async function getGoldenStockLatest(token: string): Promise<GoldenStockScan> {
  const r = await fetch(`${BASE}/api/v1/golden-stock/latest`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getGoldenStockHistory(token: string, limit = 30): Promise<GoldenStockHistoryItem[]> {
  const r = await fetch(`${BASE}/api/v1/golden-stock/history?limit=${limit}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getGoldenStockByDate(token: string, date: string): Promise<GoldenStockScan> {
  const r = await fetch(`${BASE}/api/v1/golden-stock/history/${date}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function triggerGoldenStockScan(token: string): Promise<GoldenStockScan> {
  const r = await fetch(`${BASE}/api/v1/golden-stock/scan`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getGoldenStockPerformance(token: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/v1/golden-stock/performance`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── DSWS (Daily Discovery Watchlist Summary) ─────────────────────────────────

export type DswsBucket = 'STRONG_BUY' | 'BUY' | 'SELL' | 'STRONG_SELL'

export type DswsCheckpoint = {
  time: string
  price: number
  pct_change: number
  captured_at: string
}

export type DswsPick = {
  symbol: string
  name: string
  signal: DswsBucket
  score: number
  entry_price: number
  stop_loss: number
  target: number
  added_at: string
  checkpoints: DswsCheckpoint[]
  close_price?: number | null
  close_pct?: number | null
}

export type DswsScan = {
  id?: string
  scan_date: string
  generated_at: string
  closed_out: boolean
  buckets: Record<DswsBucket, DswsPick[]>
}

export type DswsReportEntry = {
  symbol: string
  name: string
  scan_date: string
  pct_change: number
  selected_at: string
  entry_price: number | null
  current_price: number | null
  forecast: 'UP' | 'DOWN' | 'FLAT' | 'N/A'
  ai_score: number
}

export type DswsBucketStats = {
  count: number
  avg_return_pct: number
  win_rate_pct: number
  best: DswsReportEntry | null
  worst: DswsReportEntry | null
  entries: DswsReportEntry[]
}

export type DswsEngine = 'STOCK_OF_DAY' | 'GOLDEN_STOCK' | 'BTST'

export type DswsReport = {
  period: 'day' | 'week' | 'month'
  start_date: string
  end_date: string
  days_included: number
  buckets: Record<DswsBucket, DswsBucketStats>
  engines: Record<DswsEngine, DswsBucketStats>
  best_stock: DswsReportEntry | null
  worst_stock: DswsReportEntry | null
}

export async function getDswsToday(token: string): Promise<DswsScan> {
  const r = await fetch(`${BASE}/api/v1/dsws/today`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getDswsByDate(token: string, date: string): Promise<DswsScan> {
  const r = await fetch(`${BASE}/api/v1/dsws/history/${date}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getDswsReport(
  token: string,
  period: 'day' | 'week' | 'month',
  date?: string,
): Promise<DswsReport> {
  const q = date ? `period=${period}&date=${date}` : `period=${period}`
  const r = await fetch(`${BASE}/api/v1/dsws/report?${q}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function triggerDswsGenerate(token: string): Promise<DswsScan> {
  const r = await fetch(`${BASE}/api/v1/dsws/generate`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function triggerDswsTrack(token: string): Promise<{ recorded: number }> {
  const r = await fetch(`${BASE}/api/v1/dsws/track`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── BTST (Buy Today, Sell Tomorrow) ──────────────────────────────────────────

export type BTSTPick = {
  rank: number
  symbol: string
  name: string
  sector: string
  entry_price: number
  stop_loss: number
  target_1: number
  target_2: number
  risk_reward: number
  confidence_score: number
  breakout_score: number
  relative_strength_score: number
  volume_score: number
  news_score: number
  fo_score: number
  reasons: string[]
  current_price: number
  change_pct: number
  rsi: number
  volume_ratio: number
  breakout_consolidation: boolean
  consolidation_days: number
  relative_strength_5d: number
  relative_strength_20d: number
  news_sentiment: number | null
  news_mentions: number
  pcr: number | null
  fo_bullish: boolean
  above_sma20: boolean
  above_sma50: boolean
  outcome?: string | null
  actual_close?: number | null
  actual_pct?: number | null
  resolved_at?: string | null
}

export type BTSTScanResult = {
  id?: string
  scan_date: string
  scan_time: string
  universe_scanned: number
  passed_filter: number
  nifty_ret_5d: number
  nifty_ret_20d: number
  picks: BTSTPick[]
  created_at?: string
}

export type BTSTHistoryItem = {
  id: string
  scan_date: string
  scan_time: string
  universe_scanned: number
  passed_filter: number
  pick_count: number
  top_symbol: string
  top_score: number
  created_at?: string
}

export async function getBTSTLatest(token: string): Promise<BTSTScanResult> {
  const r = await fetch(`${BASE}/api/v1/btst/latest`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getBTSTHistory(token: string, limit = 30): Promise<BTSTHistoryItem[]> {
  const r = await fetch(`${BASE}/api/v1/btst/history?limit=${limit}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getBTSTByDate(token: string, date: string): Promise<BTSTScanResult> {
  const r = await fetch(`${BASE}/api/v1/btst/history/${date}`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function triggerBTSTScan(token: string): Promise<BTSTScanResult> {
  const r = await fetch(`${BASE}/api/v1/btst/scan`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getBTSTPerformance(token: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/v1/btst/performance`, { headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── Market Sentiment Forecast ────────────────────────────────────────────────

export type SentimentForecastDay = {
  date: string
  weekday: string
  forecast_bull_pct: number
  forecast_label: string
  actual_bull_pct: number | null
  actual_label: string | null
  label_match: boolean | null
  error_pct: number | null
  resolved_at: string | null
}

export type SentimentForecastAccuracy = {
  days_resolved: number
  days_correct: number
  accuracy_pct: number | null
  avg_error_pct: number | null
}

export type SentimentForecastInputs = {
  avg_bull_pct_3d: number
  days_of_history_used: number
  vix_value: number | null
  vix_adjustment: number
  nifty_momentum_pct: number
  nifty_adjustment: number
}

export type WeeklySentimentForecast = {
  week_start: string
  generated_at: string
  inputs: SentimentForecastInputs
  days: SentimentForecastDay[]
  accuracy: SentimentForecastAccuracy
}

export async function getCurrentWeekSentimentForecast(token: string): Promise<WeeklySentimentForecast | null> {
  const r = await fetch(`${BASE}/api/v1/sentiment-forecast/current-week`, { headers: authHeaders(token) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getSentimentForecastWeek(token: string, weekStart: string): Promise<WeeklySentimentForecast | null> {
  const r = await fetch(`${BASE}/api/v1/sentiment-forecast/week/${weekStart}`, { headers: authHeaders(token) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getSentimentForecastHistory(token: string, limit = 12): Promise<WeeklySentimentForecast[]> {
  const r = await fetch(`${BASE}/api/v1/sentiment-forecast/history?limit=${limit}`, { headers: authHeaders(token) })
  if (!r.ok) return []
  return r.json()
}

export async function generateSentimentForecast(token: string): Promise<WeeklySentimentForecast> {
  const r = await fetch(`${BASE}/api/v1/sentiment-forecast/generate`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function triggerSentimentSnapshot(token: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/v1/sentiment-forecast/snapshot`, { method: 'POST', headers: authHeaders(token) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── Chat Trading Agent ───────────────────────────────────────────────────────

export type TradingAgentLink = { href: string; label: string }
export type TradingAgentReply = { answer: string; suggestions: string[]; link?: TradingAgentLink | null }

export async function askTradingAgent(token: string, question: string): Promise<TradingAgentReply> {
  const res = await fetch(`${BASE}/api/v1/agent/chat`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error('Trading agent is unavailable right now')
  return res.json()
}

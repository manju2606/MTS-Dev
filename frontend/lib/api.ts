const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type User = {
  id: string
  email: string
  full_name: string
  role: string
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

export async function getMe(token: string): Promise<User> {
  const res = await fetch(`${BASE}/api/v1/auth/me`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error('Unauthorized')
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

export type ChartPeriod = '1W' | '1M' | '3M' | '6M' | '1Y'

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

export async function useSimulatedBroker(token: string): Promise<BrokerStatus> {
  const res = await fetch(`${BASE}/api/v1/broker/use-simulated`, { method: 'POST', headers: authHeaders(token) })
  if (!res.ok) throw new Error('Failed')
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

export async function closeTrade(token: string, tradeId: string): Promise<Trade> {
  const res = await fetch(`${BASE}/api/v1/paper/trades/${tradeId}/close`, {
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

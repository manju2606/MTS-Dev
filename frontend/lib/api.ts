const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type User = {
  id: string
  email: string
  full_name: string
  role: string
}

export type WatchlistItem = {
  id: string
  user_id: string
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
): Promise<BacktestResult> {
  const res = await fetch(`${BASE}/api/v1/backtest/run`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, period }),
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

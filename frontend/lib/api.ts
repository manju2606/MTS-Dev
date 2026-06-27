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

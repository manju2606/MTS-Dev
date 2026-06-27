'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addToWatchlist,
  getMe,
  getQuote,
  getWatchlist,
  removeFromWatchlist,
  seedDefaultWatchlist,
} from '@/lib/api'
import type { Quote, User, WatchlistItem } from '@/lib/api'

// --- Phase-1 momentum signal (replaces AI Engine in Phase 2) ---
type Signal = 'BUY' | 'HOLD' | 'SELL'

function computeSignal(q: Quote): { score: number; signal: Signal } {
  const range = q.day_high - q.day_low
  const pos = range > 0 ? (q.price - q.day_low) / range : 0.5
  // score 0–100: blends momentum (change_pct) with intraday position
  const raw = 50 + q.change_pct * 6 + (pos - 0.5) * 20
  const score = Math.round(Math.min(100, Math.max(0, raw)))
  const signal: Signal = score >= 60 ? 'BUY' : score <= 40 ? 'SELL' : 'HOLD'
  return { score, signal }
}

function SignalBadge({ signal }: { signal: Signal }) {
  const cls =
    signal === 'BUY'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
      : signal === 'SELL'
        ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
        : 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${cls}`}>
      {signal}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 60 ? 'bg-emerald-500' : score <= 40 ? 'bg-red-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 text-right text-xs text-zinc-500 dark:text-zinc-400">{score}</span>
    </div>
  )
}

export default function DashboardView() {
  const router = useRouter()
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<User | null>(null)
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [addSymbol, setAddSymbol] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const fetchQuotes = useCallback(async (watchlistItems: WatchlistItem[]) => {
    if (watchlistItems.length === 0) return
    const results = await Promise.allSettled(
      watchlistItems.map(item => getQuote(tokenRef.current, item.symbol)),
    )
    setQuotes(prev => {
      const next = { ...prev }
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[watchlistItems[i].symbol] = r.value
      })
      return next
    })
  }, [])

  const fetchWatchlist = useCallback(async () => {
    const wl = await getWatchlist(tokenRef.current)
    setItems(wl)
    await fetchQuotes(wl)
  }, [fetchQuotes])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t

    Promise.all([getMe(t), getWatchlist(t)])
      .then(async ([me, wl]) => {
        setUser(me)
        if (wl.length === 0) {
          // Auto-seed defaults for new users
          setSeeding(true)
          try {
            await seedDefaultWatchlist(t)
            const seeded = await getWatchlist(t)
            setItems(seeded)
            await fetchQuotes(seeded)
          } finally {
            setSeeding(false)
          }
        } else {
          setItems(wl)
          await fetchQuotes(wl)
        }
      })
      .catch(() => {
        localStorage.removeItem('mts_token')
        router.replace('/login')
      })
      .finally(() => setLoading(false))
  }, [router, fetchQuotes])

  // Refresh quotes every 30 s
  useEffect(() => {
    if (items.length === 0) return
    const id = setInterval(() => fetchQuotes(items), 30_000)
    return () => clearInterval(id)
  }, [items, fetchQuotes])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addSymbol.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      await addToWatchlist(tokenRef.current, addSymbol.trim())
      setAddSymbol('')
      await fetchWatchlist()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add symbol')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleRemove(symbol: string) {
    try {
      await removeFromWatchlist(tokenRef.current, symbol)
      setItems(prev => prev.filter(i => i.symbol !== symbol))
      setQuotes(prev => { const n = { ...prev }; delete n[symbol]; return n })
    } catch {
      await fetchWatchlist()
    }
  }

  function handleSignOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
  }

  if (loading || seeding) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-400">{seeding ? 'Loading market data…' : 'Loading…'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Manju Trade AI Pro
            </span>
            <nav className="flex items-center gap-4 text-xs">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">Watchlist</span>
              <Link href="/paper" className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
                Paper Trading
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{user?.full_name}</span>
            <button
              onClick={handleSignOut}
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Watchlist</h1>
          <p className="text-xs text-zinc-400">Score &amp; signal updated every 30 s</p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Your watchlist is empty. Add a symbol below.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500">Symbol</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Change</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">High</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Low</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Volume</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500">Score</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500">Signal</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map(item => {
                  const q = quotes[item.symbol]
                  const up = q ? q.change >= 0 : null
                  const sig = q ? computeSignal(q) : null
                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {item.symbol.replace(/\.(NS|BO)$/, '')}
                        </span>
                        <span className="ml-2 text-xs text-zinc-400">{item.exchange}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-900 dark:text-zinc-50">
                        {q ? `₹${q.price.toFixed(2)}` : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono text-xs ${
                          up === null
                            ? 'text-zinc-400'
                            : up
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-500 dark:text-red-400'
                        }`}
                      >
                        {q
                          ? `${up ? '+' : ''}${q.change.toFixed(2)} (${up ? '+' : ''}${q.change_pct.toFixed(2)}%)`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {q ? `₹${q.day_high.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {q ? `₹${q.day_low.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {q ? q.volume.toLocaleString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {sig ? <ScoreBar score={sig.score} /> : <span className="text-xs text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {sig ? <SignalBadge signal={sig.signal} /> : <span className="text-xs text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemove(item.symbol)}
                          aria-label={`Remove ${item.symbol}`}
                          className="text-zinc-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleAdd} className="mt-4 flex items-start gap-2">
          <div className="flex flex-col gap-1">
            <input
              value={addSymbol}
              onChange={e => setAddSymbol(e.target.value)}
              placeholder="e.g. RELIANCE or TCS.NS"
              disabled={addLoading}
              className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
            {addError && (
              <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={addLoading || !addSymbol.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addLoading ? 'Adding…' : 'Add'}
          </button>
        </form>
      </main>
    </div>
  )
}

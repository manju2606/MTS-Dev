'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { analyzeBatch, getWatchlist } from '@/lib/api'
import type { AIRecommendation } from '@/lib/api'

type Signal = 'BUY' | 'SELL' | 'HOLD'

const NAV = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'

function NavBar() {
  const router = useRouter()
  function signOut() { localStorage.removeItem('mts_token'); router.replace('/login') }
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Manju Trade AI Pro</span>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/dashboard" className={NAV}>Watchlist</Link>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">AI Analysis</span>
            <Link href="/risk" className={NAV}>Risk</Link>
            <Link href="/backtest" className={NAV}>Backtest</Link>
            <Link href="/paper" className={NAV}>Paper Trading</Link>
          </nav>
        </div>
        <button onClick={signOut} className={`text-xs ${NAV}`}>Sign out</button>
      </div>
    </header>
  )
}

function SignalBadge({ signal }: { signal: Signal }) {
  const cls =
    signal === 'BUY'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
      : signal === 'SELL'
        ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
        : 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${cls}`}>
      {signal}
    </span>
  )
}

function ConfBar({ pct }: { pct: number }) {
  const w = Math.round(pct * 100)
  const color = w >= 70 ? 'bg-emerald-500' : w >= 50 ? 'bg-amber-400' : 'bg-zinc-300'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-zinc-500">{w}%</span>
    </div>
  )
}

function RecCard({ rec }: { rec: AIRecommendation }) {
  const sym = rec.symbol.replace(/\.(NS|BO)$/, '')
  const rrColor = rec.risk_reward_ratio >= 2 ? 'text-emerald-600 dark:text-emerald-400'
    : rec.risk_reward_ratio >= 1.5 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-500 dark:text-red-400'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="text-xs text-zinc-400">{rec.symbol.includes('.BO') ? 'BSE' : 'NSE'}</p>
        </div>
        <SignalBadge signal={rec.signal as Signal} />
      </div>

      <div>
        <p className="mb-1 text-xs text-zinc-500">Confidence</p>
        <ConfBar pct={rec.confidence} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-400">Entry</p>
          <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{rec.entry_price.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <p className="text-zinc-400">Stop Loss</p>
          <p className="font-mono font-semibold text-red-600 dark:text-red-400">₹{rec.stop_loss.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="text-zinc-400">Target</p>
          <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">₹{rec.target.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-400">R:R</p>
          <p className={`font-mono font-semibold ${rrColor}`}>{rec.risk_reward_ratio.toFixed(2)}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-400">
        Hold: <span className="text-zinc-600 dark:text-zinc-300">{rec.holding_period}</span>
      </p>

      <p className="text-xs italic text-zinc-500 dark:text-zinc-400">{rec.explanation}</p>

      {rec.signal !== 'HOLD' && (
        <Link
          href={`/paper?symbol=${encodeURIComponent(rec.symbol)}&signal=${rec.signal}`}
          className="mt-1 rounded-lg bg-indigo-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Trade it →
        </Link>
      )}
    </div>
  )
}

export default function AIView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [recs, setRecs] = useState<AIRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
  }, [router])

  const analyzeAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const wl = await getWatchlist(tokenRef.current)
      if (wl.length === 0) { setError('Your watchlist is empty. Add symbols on the dashboard first.'); return }
      const results = await analyzeBatch(tokenRef.current, wl.map(i => i.symbol))
      setRecs(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [])

  if (!authChecked) return null

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Analysis</h1>
            <p className="text-xs text-zinc-400">
              Powered by Claude — technical + momentum analysis on your watchlist
            </p>
          </div>
          <button
            onClick={analyzeAll}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Analysing…' : 'Analyse All'}
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {!loading && recs.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              Click <strong>Analyse All</strong> to get Claude&apos;s recommendations for your watchlist.
            </p>
          </div>
        )}

        {!loading && recs.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map(r => <RecCard key={r.id} rec={r} />)}
          </div>
        )}
      </main>
    </div>
  )
}

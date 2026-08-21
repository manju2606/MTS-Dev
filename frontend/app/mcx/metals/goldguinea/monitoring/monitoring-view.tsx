'use client'

import { useCallback, useEffect, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getMetalQuote, getGoldStrategyScore, getGoldStrategyRiskStatus } from '@/lib/api'
import type { NgQuote, GoldStrategyScore, GoldRiskStatus } from '@/lib/api'
import { GoldRiskStatusCard, GOLD_VERDICT_STYLE, cls, pnlColor } from '../../metals-view'
import { GoldGuineaSubNav } from '../goldguinea-view'

const REFRESH_MS = 60_000
const CALL_TIMEOUT_MS = 20_000

// The backend calls behind these endpoints can hang well past any reasonable
// UI wait (e.g. a stalled upstream Kite/Mongo call with no timeout of its
// own) -- without this, a single slow call leaves the whole page stuck on
// "Loading..." forever. Race each call independently so one slow piece
// degrades to an error instead of blocking the others that did come back.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}

function DirectionCard({ direction, score, loading }: {
  direction: 'BUY' | 'SELL'
  score: GoldStrategyScore | null
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <span className={cls(
          'rounded-full px-2.5 py-0.5 text-xs font-bold',
          direction === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white',
        )}>
          {direction}
        </span>
        {score && (
          <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', GOLD_VERDICT_STYLE[score.verdict])}>
            {score.signal_label}
          </span>
        )}
      </div>
      {loading && !score ? (
        <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      ) : score ? (
        <>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-zinc-50">{score.score_pct.toFixed(1)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            1H trend {score.trend} — {score.trend_matches_direction ? 'matches this direction' : 'does NOT match (forces NO TRADE)'}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">{score.points_earned}/{score.points_available} pts</p>
        </>
      ) : (
        <p className="text-xs text-zinc-400">Unavailable</p>
      )}
    </div>
  )
}

export default function GoldGuineaMonitoringView() {
  const [quote, setQuote] = useState<NgQuote | null>(null)
  const [buyScore, setBuyScore] = useState<GoldStrategyScore | null>(null)
  const [sellScore, setSellScore] = useState<GoldStrategyScore | null>(null)
  const [riskStatus, setRiskStatus] = useState<GoldRiskStatus | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    try {
      const [q, buy, sell, risk] = await Promise.allSettled([
        withTimeout(getMetalQuote(t, 'GOLDGUINEA'), CALL_TIMEOUT_MS, 'Quote'),
        withTimeout(getGoldStrategyScore(t, 'BUY', 'GOLDGUINEA'), CALL_TIMEOUT_MS, 'BUY score'),
        withTimeout(getGoldStrategyScore(t, 'SELL', 'GOLDGUINEA'), CALL_TIMEOUT_MS, 'SELL score'),
        withTimeout(getGoldStrategyRiskStatus(t, 'GOLDGUINEA'), CALL_TIMEOUT_MS, 'Risk status'),
      ])
      if (q.status === 'fulfilled') setQuote(q.value)
      if (buy.status === 'fulfilled') setBuyScore(buy.value)
      if (sell.status === 'fulfilled') setSellScore(sell.value)
      if (risk.status === 'fulfilled') setRiskStatus(risk.value)
      const failed = [q, buy, sell, risk].filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      setError(failed.length > 0 ? failed.map(f => f.reason instanceof Error ? f.reason.message : String(f.reason)).join(' · ') : null)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh monitoring data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Gold Guinea — Monitoring</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Live engine health: current price, today&apos;s risk-gate status, and both BUY and SELL reads at once
          — so a flip in either direction is visible immediately, not just the side you last looked at.
        </p>

        <div className="mt-6 space-y-6">
          <GoldGuineaSubNav active="Monitoring" />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                {quote ? `₹${quote.last_price.toFixed(2)}` : '—'}
              </span>
              {quote && (
                <span className={cls('font-mono text-xs font-semibold', pnlColor(quote.change))}>
                  {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
                </span>
              )}
              {quote?.expiry && <span className="text-xs text-zinc-400">Expiry {quote.expiry}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span>
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Loading…'}
              </span>
              <button
                onClick={refresh}
                disabled={loading}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? 'Refreshing…' : 'Refresh Now'}
              </button>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

          <GoldRiskStatusCard status={riskStatus} />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Live Engine Read — Both Directions
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <DirectionCard direction="BUY" score={buyScore} loading={loading} />
              <DirectionCard direction="SELL" score={sellScore} loading={loading} />
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">Auto-refreshes every 60 seconds.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

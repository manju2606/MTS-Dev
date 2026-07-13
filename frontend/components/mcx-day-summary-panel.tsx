'use client'

import { useEffect, useState } from 'react'
import { getMcxDaySummary, getMcxDaySummaryHistory } from '@/lib/api'
import type { McxDaySummary } from '@/lib/api'

// Crisp end-of-day-style summary for one MCX contract, plus a short history
// list -- one component reused for every contract (NG or Metals) on My
// Trading Dashboard, since `market` alone picks the right backend route
// (see mcx_day_summary_service.py's shared build_day_summary).
export function McxDaySummaryPanel({ contract, market }: { contract: string; market: 'ng' | 'metals' }) {
  const [today, setToday] = useState<McxDaySummary | null>(null)
  const [history, setHistory] = useState<McxDaySummary[]>([])
  const [todayError, setTodayError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null); setTodayError(null)
    // allSettled, not all -- an on-demand "today" build can fail on its own
    // (e.g. a broker hiccup) without history (already-stored EOD summaries)
    // being unavailable too; show whichever half actually came back.
    Promise.allSettled([
      getMcxDaySummary(t, contract, market),
      getMcxDaySummaryHistory(t, contract, market, 14),
    ]).then(([todayResult, historyResult]) => {
      if (todayResult.status === 'fulfilled') setToday(todayResult.value)
      else setTodayError(todayResult.reason instanceof Error ? todayResult.reason.message : 'Unavailable')
      if (historyResult.status === 'fulfilled') setHistory(historyResult.value)
      else if (todayResult.status === 'rejected') setError('Failed to load day summary')
    }).finally(() => setLoading(false))
  }, [contract, market])

  if (loading) {
    return <div className="h-20 animate-pulse rounded-lg" style={{ background: 'rgba(148,163,184,0.1)' }} />
  }
  if (error) {
    return <p className="px-1 py-3 text-xs" style={{ color: '#fca5a5' }}>{error}</p>
  }
  // Fall back to the most recent stored history entry as "today" if the
  // live on-demand build failed but there's at least past history to show.
  const shown = today ?? history[0] ?? null
  if (!shown) {
    return (
      <p className="px-1 py-3 text-xs" style={{ color: '#94a3b8' }}>
        {todayError ?? 'No day summary available yet.'}
      </p>
    )
  }
  const todayIsFallback = !today && shown === history[0]
  return renderPanel(shown, history, todayIsFallback)
}

function renderPanel(today: McxDaySummary, history: McxDaySummary[], isFallback: boolean) {

  // History already includes today's on-demand build (day-summary-history
  // only ever contains what the scheduled EOD job stored, so "today" here
  // is the live on-demand summary above, not necessarily in that list yet).
  const pastDays = history.filter(h => h.date !== today.date).slice(0, 7)

  return (
    <div className="space-y-3 rounded-lg p-4 text-xs" style={{ background: 'rgba(15,23,42,0.6)', color: '#cbd5e1' }}>
      {isFallback && (
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
          Live summary unavailable — showing last stored day ({today.date})
        </p>
      )}
      <p className="text-sm font-medium" style={{ color: '#eef2ff' }}>{today.narrative}</p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <div><span style={{ opacity: 0.6 }}>Day</span> {today.day_low.toFixed(2)}&ndash;{today.day_high.toFixed(2)}</div>
        <div><span style={{ opacity: 0.6 }}>Week</span> {today.week_low.toFixed(2)}&ndash;{today.week_high.toFixed(2)}</div>
        <div><span style={{ opacity: 0.6 }}>Month</span> {today.month_low.toFixed(2)}&ndash;{today.month_high.toFixed(2)}</div>
        <div><span style={{ opacity: 0.6 }}>OI</span> {today.oi.toLocaleString('en-IN')}</div>
      </div>

      {pastDays.length > 0 && (
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wider" style={{ opacity: 0.6 }}>Previous Days</p>
          <div className="space-y-1">
            {pastDays.map(h => (
              <p key={h.date} className="flex items-baseline gap-2">
                <span className="w-16 shrink-0 font-mono" style={{ opacity: 0.6 }}>{h.date.slice(5)}</span>
                <span>{h.narrative}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <p style={{ opacity: 0.5 }}>
        Week/month high-low stand in for a 52-week range, which doesn&apos;t apply here -- MCX contracts are
        monthly-expiring futures, so the current front-month instrument has no year-long price history of its own.
      </p>
    </div>
  )
}

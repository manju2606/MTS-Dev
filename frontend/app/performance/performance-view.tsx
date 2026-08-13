'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getPerformanceCalls, getPerformanceSummary } from '@/lib/api'
import type { PerformanceCall, PerformanceSummary } from '@/lib/api'

const DAY_OPTIONS: { label: string; value: number | null }[] = [
  { label: '7D', value: 7 },
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: '1Y', value: 365 },
  { label: 'All', value: null },
]

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-zinc-400'
  return pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
}

function returnColor(pct: number | null): string {
  if (pct === null) return 'text-zinc-400'
  return pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function StatChip({
  label, value, className, onClick, active,
}: {
  label: string
  value: string | number
  className?: string
  onClick?: () => void
  active?: boolean
}) {
  const content = (
    <>
      <p className={`text-lg font-bold ${className ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
    </>
  )
  if (!onClick) {
    return <div className="rounded-lg bg-zinc-50 px-3 py-2 text-center dark:bg-zinc-800/60">{content}</div>
  }
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-center transition-colors ${
        active
          ? 'bg-indigo-100 ring-1 ring-inset ring-indigo-400 dark:bg-indigo-950/50 dark:ring-indigo-500'
          : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800'
      }`}
    >
      {content}
    </button>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })
  } catch {
    return iso.slice(5, 10)
  }
}

function CallsPanel({ calls, loading, error }: { calls: PerformanceCall[] | null; loading: boolean; error: string | null }) {
  if (loading) return <p className="py-3 text-center text-xs text-zinc-400">Loading calls…</p>
  if (error) return <p className="py-3 text-center text-xs text-red-500">{error}</p>
  if (!calls || calls.length === 0) return <p className="py-3 text-center text-xs text-zinc-400">No calls in this window.</p>
  return (
    <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
      <table className="w-full min-w-[360px] text-[11px]">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
            {['Symbol', 'Date', 'Entry', 'Exit', 'Return'].map(h => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-zinc-800 dark:text-zinc-200">{c.symbol.replace(/\.(NS|BO)$/, '')}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-zinc-500 dark:text-zinc-400">{fmtDate(c.date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono">{c.entry_price != null ? c.entry_price.toFixed(2) : '—'}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono">{c.exit_price != null ? c.exit_price.toFixed(2) : '—'}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 font-mono ${returnColor(c.return_pct)}`}>{fmtPct(c.return_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourceCard({
  source, token, days,
}: {
  source: PerformanceSummary['sources'][number]
  token: string
  days: number | null
}) {
  const [expanded, setExpanded] = useState<'win' | 'loss' | 'open' | null>(null)
  const [calls, setCalls] = useState<PerformanceCall[] | null>(null)
  const [callsLoading, setCallsLoading] = useState(false)
  const [callsError, setCallsError] = useState<string | null>(null)

  // Collapse any open calls panel when the day-range filter changes --
  // this card instance survives the filter change (same key), so without
  // this the panel would keep showing calls fetched under the old window.
  useEffect(() => {
    setExpanded(null)
    setCalls(null)
  }, [days])

  function toggle(outcome: 'win' | 'loss' | 'open') {
    if (expanded === outcome) { setExpanded(null); return }
    setExpanded(outcome)
    setCalls(null)
    setCallsError(null)
    setCallsLoading(true)
    getPerformanceCalls(token, source.key, outcome, days)
      .then(setCalls)
      .catch(e => setCallsError(e instanceof Error ? e.message : 'Failed to load calls'))
      .finally(() => setCallsLoading(false))
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{source.label}</h3>
        {!source.tracked && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            not tracked
          </span>
        )}
      </div>

      {source.tracked ? (
        <>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <StatChip label="Calls" value={source.total_calls} />
            <StatChip
              label="Wins" value={source.wins ?? 0} className="text-emerald-600 dark:text-emerald-400"
              active={expanded === 'win'}
              onClick={source.wins ? () => toggle('win') : undefined}
            />
            <StatChip
              label="Losses" value={source.losses ?? 0} className="text-red-500 dark:text-red-400"
              active={expanded === 'loss'}
              onClick={source.losses ? () => toggle('loss') : undefined}
            />
            <StatChip
              label="Open" value={source.open ?? 0}
              active={expanded === 'open'}
              onClick={source.open ? () => toggle('open') : undefined}
            />
          </div>
          <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Win rate</p>
              <p className={`text-xl font-bold ${pctColor(source.win_rate_pct)}`}>
                {source.win_rate_pct === null ? '—' : `${source.win_rate_pct.toFixed(1)}%`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Avg return</p>
              <p className={`text-sm font-semibold ${returnColor(source.avg_return_pct)}`}>
                {fmtPct(source.avg_return_pct)}
              </p>
            </div>
          </div>
          {expanded && (
            <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <CallsPanel calls={calls} loading={callsLoading} error={callsError} />
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Total calls</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{source.total_calls}</p>
          </div>
          <p className="max-w-[55%] text-right text-[11px] text-zinc-400">
            Scores entry/SL/target once and never checks the outcome afterward — no win/loss data exists yet.
          </p>
        </div>
      )}
    </div>
  )
}

export function PerformanceView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [days, setDays] = useState<number | null>(90)
  const [data, setData] = useState<PerformanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (d: number | null) => {
    const token = tokenRef.current
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await getPerformanceSummary(token, d)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance summary')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    load(days).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  function changeDays(d: number | null) {
    setDays(d)
    load(d).catch(() => {})
  }

  if (!authChecked) return null

  const overall = data?.overall

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Performance" />
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Performance</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Win/loss across every AI-generated trading call — MCX, Golden Stock, BTST, Stock of the Day,
              Paper Trades, and Chartink&apos;s Breakout Watchlist have real resolved outcomes; Golden Egg and
              raw Chartink candidates outside the Breakout Watchlist only score once and show call counts
              until outcome tracking exists for them too.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {DAY_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => changeDays(opt.value)}
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  days === opt.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>
        )}

        {loading && !data ? (
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        ) : overall ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Total calls</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{overall.total_calls}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Wins</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{overall.wins}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Losses</p>
                <p className="text-2xl font-bold text-red-500 dark:text-red-400">{overall.losses}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Combined win rate</p>
                <p className={`text-2xl font-bold ${pctColor(overall.win_rate_pct)}`}>
                  {overall.win_rate_pct === null ? '—' : `${overall.win_rate_pct.toFixed(1)}%`}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-400">Sources tracked</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                  {overall.tracked_sources}<span className="text-sm font-normal text-zinc-400">/{overall.tracked_sources + overall.untracked_sources}</span>
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.sources.map(source => (
              <SourceCard key={source.key} source={source} token={tokenRef.current} days={days} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

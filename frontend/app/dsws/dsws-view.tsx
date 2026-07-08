'use client'

import { useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import {
  getDswsToday,
  getDswsReport,
  triggerDswsGenerate,
  triggerDswsTrack,
} from '@/lib/api'
import type { DswsBucket, DswsScan, DswsPick, DswsReport, DswsReportEntry } from '@/lib/api'

const BUCKETS: DswsBucket[] = ['STRONG_BUY', 'BUY', 'SELL', 'STRONG_SELL']

const BUCKET_META: Record<DswsBucket, { label: string; accent: string; text: string }> = {
  STRONG_BUY: { label: 'Strong Buy', accent: 'bg-emerald-600', text: 'text-emerald-600' },
  BUY: { label: 'Buy', accent: 'bg-emerald-400', text: 'text-emerald-500' },
  SELL: { label: 'Sell', accent: 'bg-red-400', text: 'text-red-500' },
  STRONG_SELL: { label: 'Strong Sell', accent: 'bg-red-600', text: 'text-red-600' },
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

function PctBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-zinc-400">no data yet</span>
  }
  const pos = pct >= 0
  return (
    <span className={`text-xs font-semibold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function PickCard({ pick }: { pick: DswsPick }) {
  const sym = pick.symbol.replace('.NS', '').replace('.BO', '')
  const latestPct = pick.close_pct ?? pick.checkpoints[pick.checkpoints.length - 1]?.pct_change ?? null

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="truncate text-xs text-zinc-500">{pick.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-zinc-400">{pick.close_pct != null ? 'Close' : 'Latest'}</p>
          <PctBadge pct={latestPct} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
          <p className="text-[10px] text-zinc-400">Entry</p>
          <p className="font-bold text-zinc-900 dark:text-zinc-50">&#8377;{fmt(pick.entry_price)}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
          <p className="text-[10px] text-red-400">Stop Loss</p>
          <p className="font-bold text-red-600">&#8377;{fmt(pick.stop_loss)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target</p>
          <p className="font-bold text-emerald-600">&#8377;{fmt(pick.target)}</p>
        </div>
      </div>

      {pick.checkpoints.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-400">
                {pick.checkpoints.map(cp => (
                  <th key={cp.time} className="px-1.5 py-1 text-left font-medium">{cp.time}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {pick.checkpoints.map(cp => (
                  <td key={cp.time} className="px-1.5 py-1">
                    <PctBadge pct={cp.pct_change} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BucketColumn({ bucket, picks }: { bucket: DswsBucket; picks: DswsPick[] }) {
  const meta = BUCKET_META[bucket]
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${meta.accent}`} />
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{meta.label}</h2>
        <span className="text-xs text-zinc-400">({picks.length})</span>
      </div>
      {picks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
          No picks in this bucket today
        </div>
      ) : (
        <div className="space-y-3">
          {picks.map(pick => <PickCard key={pick.symbol} pick={pick} />)}
        </div>
      )}
    </div>
  )
}

const PERIODS: { label: string; value: 'day' | 'week' | 'month' }[] = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
]

function ReportEntryCard({ label, entry }: { label: string; entry: DswsReportEntry | null }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      {entry ? (
        <>
          <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-50">
            {entry.symbol.replace('.NS', '').replace('.BO', '')}
          </p>
          <p className="text-xs text-zinc-500">{entry.name} &middot; {entry.scan_date}</p>
          <div className="mt-1"><PctBadge pct={entry.pct_change} /></div>
        </>
      ) : (
        <p className="mt-1 text-sm text-zinc-400">No data yet</p>
      )}
    </div>
  )
}

function ReportPanel({
  report, period, onPeriodChange, loading,
}: {
  report: DswsReport | null
  period: 'day' | 'week' | 'month'
  onPeriodChange: (p: 'day' | 'week' | 'month') => void
  loading: boolean
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Performance Report</h2>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                period === p.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !report ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-400">
            {report.start_date} &rarr; {report.end_date} &middot; {report.days_included} day(s) of data
          </p>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReportEntryCard label="Best Stock Overall" entry={report.best_stock} />
            <ReportEntryCard label="Worst Stock Overall" entry={report.worst_stock} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  {['Bucket', 'Picks', 'Avg Return', 'Win Rate', 'Best'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map(bucket => {
                  const stats = report.buckets[bucket]
                  const meta = BUCKET_META[bucket]
                  return (
                    <tr key={bucket} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className={`px-3 py-2 font-semibold ${meta.text}`}>{meta.label}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{stats.count}</td>
                      <td className="px-3 py-2"><PctBadge pct={stats.count > 0 ? stats.avg_return_pct : null} /></td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {stats.count > 0 ? `${stats.win_rate_pct.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {stats.best ? stats.best.symbol.replace('.NS', '').replace('.BO', '') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function DswsView() {
  const [scan, setScan] = useState<DswsScan | null>(null)
  const [report, setReport] = useState<DswsReport | null>(null)
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const tokenRef = useRef('')

  async function loadScan() {
    const token = tokenRef.current
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setScan(await getDswsToday(token))
    } catch {
      setScan(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadReport(p: 'day' | 'week' | 'month') {
    const token = tokenRef.current
    if (!token) return
    setReportLoading(true)
    try {
      setReport(await getDswsReport(token, p))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReportLoading(false)
    }
  }

  async function handleGenerate() {
    const token = tokenRef.current
    if (!token) return
    setGenerating(true)
    setError(null)
    try {
      setScan(await triggerDswsGenerate(token))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleTrack() {
    const token = tokenRef.current
    if (!token) return
    setTracking(true)
    setError(null)
    try {
      await triggerDswsTrack(token)
      await loadScan()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTracking(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('mts_token') ?? ''
    tokenRef.current = token
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1])) : {}
      setUserRole(payload.role ?? '')
    } catch {
      setUserRole('')
    }
    loadScan()
    loadReport('day')
  }, [])

  const isAdmin = userRole === 'admin'
  const totalPicks = scan ? BUCKETS.reduce((sum, b) => sum + scan.buckets[b].length, 0) : 0

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="DSWS" />
      <div className="mx-auto max-w-7xl px-4 py-8">

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              DSWS &mdash; Daily Discovery Watchlist Summary
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Discovery Engine picks bucketed by signal strength at 9:30 AM &nbsp;&middot;&nbsp; tracked every 30 min through close
            </p>
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-2">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Run Now'}
              </button>
              <button
                onClick={handleTrack}
                disabled={tracking || !scan}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {tracking ? 'Tracking...' : 'Track Now'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-64 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />)}
          </div>
        ) : scan === null ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 py-20 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 text-5xl">&#128203;</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">No DSWS watchlist for today yet</h3>
            <p className="mb-6 text-sm text-zinc-500">
              {isAdmin
                ? 'Generate today\'s watchlist from the current Discovery Engine picks.'
                : 'Check back after 9:30 AM IST, or ask an admin to run it.'}
            </p>
            {isAdmin && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Generate Now'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <p className="text-xs text-zinc-400">
              Generated {fmtTime(scan.generated_at)} IST &middot; {totalPicks} picks total
              {scan.closed_out ? ' · day closed out' : ''}
            </p>

            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {BUCKETS.map(bucket => (
                <BucketColumn key={bucket} bucket={bucket} picks={scan.buckets[bucket]} />
              ))}
            </div>

            <ReportPanel
              report={report}
              period={period}
              loading={reportLoading}
              onPeriodChange={p => { setPeriod(p); loadReport(p) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

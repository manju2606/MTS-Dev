'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import {
  getDswsToday,
  getDswsReport,
  triggerDswsGenerate,
  triggerDswsTrack,
} from '@/lib/api'
import type {
  DswsBucket, DswsEngine, DswsScan, DswsPick, DswsReport, DswsReportEntry, DswsBucketStats,
} from '@/lib/api'

const BUCKETS: DswsBucket[] = ['STRONG_BUY', 'BUY', 'SELL', 'STRONG_SELL']

const BUCKET_META: Record<DswsBucket, { label: string; accent: string; text: string }> = {
  STRONG_BUY: { label: 'Strong Buy', accent: 'bg-emerald-600', text: 'text-emerald-600' },
  BUY: { label: 'Buy', accent: 'bg-emerald-400', text: 'text-emerald-500' },
  SELL: { label: 'Sell', accent: 'bg-red-400', text: 'text-red-500' },
  STRONG_SELL: { label: 'Strong Sell', accent: 'bg-red-600', text: 'text-red-600' },
}

const ENGINES: DswsEngine[] = ['STOCK_OF_DAY', 'GOLDEN_STOCK', 'BTST']

const ENGINE_META: Record<DswsEngine, { label: string; text: string }> = {
  STOCK_OF_DAY: { label: 'Stock of the Day', text: 'text-indigo-600' },
  GOLDEN_STOCK: { label: 'Golden Stock', text: 'text-amber-600' },
  BTST: { label: 'BTST', text: 'text-cyan-600' },
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

function ForecastBadge({ forecast }: { forecast: string }) {
  const styles: Record<string, string> = {
    UP: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    DOWN: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    FLAT: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    'N/A': 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[forecast] ?? styles['N/A']}`}>
      {forecast === 'UP' ? '▲ UP' : forecast === 'DOWN' ? '▼ DOWN' : forecast}
    </span>
  )
}

function cleanSymbol(symbol: string) {
  return symbol.replace('.NS', '').replace('.BO', '')
}

function SymbolLink({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <Link
      href={`/trade?symbol=${encodeURIComponent(symbol)}`}
      className={className ?? 'hover:underline'}
      onClick={e => e.stopPropagation()}
    >
      {cleanSymbol(symbol)}
    </Link>
  )
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const w = 100
  const h = 28
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const step = w / (points.length - 1)
  const coords = points.map((v, i) => [i * step, h - ((v - min) / range) * h] as const)
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const stroke = last >= points[0] ? '#059669' : '#ef4444'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function PickCard({ pick }: { pick: DswsPick }) {
  const latestPct = pick.close_pct ?? pick.checkpoints[pick.checkpoints.length - 1]?.pct_change ?? null
  const sparkPoints = [0, ...pick.checkpoints.map(cp => cp.pct_change)]

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            <SymbolLink symbol={pick.symbol} className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" />
          </p>
          <p className="truncate text-xs text-zinc-500">{pick.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-zinc-400">{pick.close_pct != null ? 'Close' : 'Latest'}</p>
          <PctBadge pct={latestPct} />
        </div>
      </div>

      {sparkPoints.length > 1 && (
        <div className="mb-3">
          <Sparkline points={sparkPoints} />
        </div>
      )}

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

function BucketSection({
  bucket, picks, expanded, onToggle,
}: {
  bucket: DswsBucket
  picks: DswsPick[]
  expanded: boolean
  onToggle: () => void
}) {
  const meta = BUCKET_META[bucket]
  const withPct = picks
    .map(p => p.close_pct ?? p.checkpoints[p.checkpoints.length - 1]?.pct_change ?? null)
    .filter((v): v is number => v != null)
  const avgPct = withPct.length > 0 ? withPct.reduce((a, b) => a + b, 0) / withPct.length : null

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="w-3 shrink-0 text-[10px] text-zinc-400">{expanded ? '▾' : '▸'}</span>
          <span className={`h-2.5 w-2.5 rounded-full ${meta.accent}`} />
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{meta.label}</h2>
          <span className="text-xs text-zinc-400">({picks.length})</span>
        </div>
        {avgPct !== null && <PctBadge pct={avgPct} />}
      </button>
      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          {picks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
              No picks in this bucket today
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {picks.map(pick => <PickCard key={pick.symbol} pick={pick} />)}
            </div>
          )}
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
            <SymbolLink symbol={entry.symbol} className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" />
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

type SortKey = 'selected_at' | 'entry_price' | 'current_price' | 'pct_change' | 'ai_score'

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'selected_at', label: 'Selected' },
  { key: 'entry_price', label: 'Entry' },
  { key: 'current_price', label: 'Current' },
  { key: 'pct_change', label: 'Change' },
  { key: 'ai_score', label: 'AI Score' },
]

const FORECAST_FILTERS: { label: string; value: 'ALL' | 'UP' | 'DOWN' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Up', value: 'UP' },
  { label: 'Down', value: 'DOWN' },
]

function ReportRow({
  rowKey, label, textClass, stats, expanded, onToggle,
}: {
  rowKey: string
  label: string
  textClass: string
  stats: DswsBucketStats
  expanded: boolean
  onToggle: () => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('pct_change')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [forecastFilter, setForecastFilter] = useState<'ALL' | 'UP' | 'DOWN'>('ALL')

  const visibleEntries = useMemo(() => {
    const filtered = forecastFilter === 'ALL'
      ? stats.entries
      : stats.entries.filter(e => e.forecast === forecastFilter)
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv))
      }
      return (av as number) - (bv as number)
    })
    if (sortDir === 'desc') sorted.reverse()
    return sorted
  }, [stats.entries, sortKey, sortDir, forecastFilter])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-zinc-100 hover:bg-indigo-50/60 dark:border-zinc-800 dark:hover:bg-indigo-950/30"
      >
        <td className={`px-3 py-2 font-semibold ${textClass}`}>
          <span className="mr-1 inline-block text-[10px] text-zinc-400">{expanded ? '▾' : '▸'}</span>
          {label}
        </td>
        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{stats.count}</td>
        <td className="px-3 py-2"><PctBadge pct={stats.count > 0 ? stats.avg_return_pct : null} /></td>
        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
          {stats.count > 0 ? `${stats.win_rate_pct.toFixed(0)}%` : '—'}
        </td>
        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
          {stats.best ? <SymbolLink symbol={stats.best.symbol} className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" /> : '—'}
        </td>
      </tr>
      {expanded && (
        <tr key={`${rowKey}-expanded`} className="border-b border-zinc-100 dark:border-zinc-800">
          <td colSpan={5} className="bg-zinc-50 px-3 py-3 dark:bg-zinc-950/40">
            {stats.entries.length === 0 ? (
              <p className="text-xs text-zinc-400">No stocks in this period.</p>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-1">
                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Forecast</span>
                  {FORECAST_FILTERS.map(f => (
                    <button
                      key={f.value}
                      onClick={e => { e.stopPropagation(); setForecastFilter(f.value) }}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        forecastFilter === f.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {visibleEntries.length === 0 ? (
                  <p className="text-xs text-zinc-400">No stocks match this filter.</p>
                ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-zinc-400">
                        <th className="px-2 py-1 text-left font-medium">Stock</th>
                        <th className="px-2 py-1 text-left font-medium">Name</th>
                        {SORT_COLUMNS.map(col => (
                          <th key={col.key} className="px-2 py-1 text-left font-medium">
                            <button
                              onClick={e => { e.stopPropagation(); toggleSort(col.key) }}
                              className="flex items-center gap-0.5 font-medium hover:text-zinc-700 dark:hover:text-zinc-200"
                            >
                              {col.label}
                              {sortKey === col.key && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                            </button>
                          </th>
                        ))}
                        <th className="px-2 py-1 text-left font-medium">Forecast</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((e, i) => (
                        <tr key={`${e.symbol}-${e.scan_date}-${i}`} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="px-2 py-1 font-semibold text-zinc-800 dark:text-zinc-200">
                            <SymbolLink symbol={e.symbol} className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" />
                          </td>
                          <td className="px-2 py-1 text-zinc-500">{e.name}</td>
                          <td className="px-2 py-1 text-zinc-500 whitespace-nowrap">{fmtTime(e.selected_at)}</td>
                          <td className="px-2 py-1 text-zinc-600 dark:text-zinc-300">
                            {e.entry_price != null ? `₹${fmt(e.entry_price)}` : '—'}
                          </td>
                          <td className="px-2 py-1 text-zinc-600 dark:text-zinc-300">
                            {e.current_price != null ? `₹${fmt(e.current_price)}` : '—'}
                          </td>
                          <td className="px-2 py-1"><PctBadge pct={e.pct_change} /></td>
                          <td className="px-2 py-1 text-zinc-600 dark:text-zinc-300">{e.ai_score}</td>
                          <td className="px-2 py-1"><ForecastBadge forecast={e.forecast} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
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
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
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
                  const rowKey = `bucket:${bucket}`
                  return (
                    <ReportRow
                      key={rowKey}
                      rowKey={rowKey}
                      label={BUCKET_META[bucket].label}
                      textClass={BUCKET_META[bucket].text}
                      stats={report.buckets[bucket]}
                      expanded={expandedRow === rowKey}
                      onToggle={() => setExpandedRow(expandedRow === rowKey ? null : rowKey)}
                    />
                  )
                })}
                <tr>
                  <td colSpan={5} className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Other Engines
                  </td>
                </tr>
                {ENGINES.map(engine => {
                  const rowKey = `engine:${engine}`
                  return (
                    <ReportRow
                      key={rowKey}
                      rowKey={rowKey}
                      label={ENGINE_META[engine].label}
                      textClass={ENGINE_META[engine].text}
                      stats={report.engines[engine]}
                      expanded={expandedRow === rowKey}
                      onToggle={() => setExpandedRow(expandedRow === rowKey ? null : rowKey)}
                    />
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

const DSWS_PERIOD_KEY = 'mts_dsws_period'

function loadStoredPeriod(): 'day' | 'week' | 'month' {
  if (typeof window === 'undefined') return 'day'
  const stored = window.localStorage.getItem(DSWS_PERIOD_KEY)
  return stored === 'day' || stored === 'week' || stored === 'month' ? stored : 'day'
}

export function DswsView() {
  const [scan, setScan] = useState<DswsScan | null>(null)
  const [report, setReport] = useState<DswsReport | null>(null)
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>(loadStoredPeriod)
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [expandedBuckets, setExpandedBuckets] = useState<Set<DswsBucket>>(new Set())
  const tokenRef = useRef('')

  function toggleBucket(bucket: DswsBucket) {
    setExpandedBuckets(prev => {
      const next = new Set(prev)
      if (next.has(bucket)) next.delete(bucket)
      else next.add(bucket)
      return next
    })
  }

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
    loadReport(period)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

            <div className="space-y-3">
              {BUCKETS.map(bucket => (
                <BucketSection
                  key={bucket}
                  bucket={bucket}
                  picks={scan.buckets[bucket]}
                  expanded={expandedBuckets.has(bucket)}
                  onToggle={() => toggleBucket(bucket)}
                />
              ))}
            </div>

            <ReportPanel
              report={report}
              period={period}
              loading={reportLoading}
              onPeriodChange={p => {
                setPeriod(p)
                window.localStorage.setItem(DSWS_PERIOD_KEY, p)
                loadReport(p)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

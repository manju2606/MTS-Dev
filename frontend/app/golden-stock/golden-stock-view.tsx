'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { AddToWatchlistBtn } from '@/components/add-to-watchlist-btn'
import {
  getGoldenStockLatest,
  getGoldenStockHistory,
  getGoldenStockByDate,
  triggerGoldenStockScan,
  listWatchlists,
} from '@/lib/api'
import type { IntradayCandidate, GoldenStockScan, GoldenStockHistoryItem, Watchlist } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const SCAN_CACHE_KEY = 'golden-stock:scan'

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

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] text-zinc-500">{value}/{max}</span>
    </div>
  )
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 70 ? '#059669' : score >= 50 ? '#f59e0b' : '#dc2626'
  const pct = Math.min(100, score)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="min-w-[2.5rem] text-right text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  )
}

function RankBadge({ rank, score }: { rank: number; score: number }) {
  const bg = score >= 70 ? 'bg-emerald-600' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bg} text-xs font-bold text-white`}>
      {rank}
    </div>
  )
}

function Badge({ label, variant }: { label: string; variant: 'indigo' | 'emerald' | 'amber' | 'zinc' }) {
  const cls = {
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  }[variant]
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
  )
}

function PickCard({ pick, token, watchlists }: { pick: IntradayCandidate; token: string; watchlists: Watchlist[] }) {
  const sym = pick.symbol.replace('.NS', '').replace('.BO', '')
  const changePos = pick.change_pct >= 0

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-start gap-3">
        <RankBadge rank={pick.rank} score={pick.confidence_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{sym}</span>
            <span className={`text-xs font-semibold ${changePos ? 'text-emerald-600' : 'text-red-500'}`}>
              {changePos ? '+' : ''}{pick.change_pct.toFixed(2)}%
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{pick.name} &middot; {pick.sector}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pick.macd_bullish && <Badge label="MACD" variant="indigo" />}
            {pick.near_day_high && <Badge label="Near High" variant="amber" />}
            {pick.above_sma50 && <Badge label="SMA50+" variant="emerald" />}
            {pick.above_sma20 && <Badge label="SMA20+" variant="emerald" />}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-zinc-400">LTP</p>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">&#8377;{fmt(pick.current_price)}</p>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Confidence Score</p>
        <ConfidenceBar score={pick.confidence_score} />
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Fundamental</span>
            <ScoreBar value={pick.fundamental_score} max={30} color="#4f46e5" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Technical</span>
            <ScoreBar value={pick.technical_score} max={50} color="#0891b2" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Momentum</span>
            <ScoreBar value={pick.momentum_score} max={20} color="#059669" />
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
          <p className="text-[10px] text-zinc-400">Entry</p>
          <p className="font-bold text-zinc-900 dark:text-zinc-50">&#8377;{fmt(pick.entry_price)}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
          <p className="text-[10px] text-red-400">Stop Loss</p>
          <p className="font-bold text-red-600">&#8377;{fmt(pick.stop_loss)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target 1</p>
          <p className="font-bold text-emerald-600">&#8377;{fmt(pick.target_1)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target 2</p>
          <p className="font-bold text-emerald-600">&#8377;{fmt(pick.target_2)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
          R:R {pick.risk_reward}x
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          RSI {pick.rsi.toFixed(0)}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          ADX {pick.adx.toFixed(0)}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Vol {pick.volume_ratio.toFixed(1)}x
        </span>
      </div>

      {pick.reasons.length > 0 && (
        <ul className="mb-4 space-y-0.5">
          {pick.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <span className="mt-0.5 text-amber-500">&#9679;</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      {pick.outcome && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${
          pick.outcome === 'target_hit'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
            : pick.outcome === 'sl_hit'
            ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
        }`}>
          Outcome: {pick.outcome === 'target_hit' ? 'Target Hit' : pick.outcome === 'sl_hit' ? 'SL Hit' : 'Expired'}
          {pick.actual_pct != null && (
            <span className="ml-2">
              ({pick.actual_pct >= 0 ? '+' : ''}{pick.actual_pct.toFixed(2)}%)
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <AddToWatchlistBtn symbol={pick.symbol} token={token} watchlists={watchlists} />
        <Link
          href={`/trade?symbol=${encodeURIComponent(pick.symbol)}`}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
        >
          Trade Now →
        </Link>
      </div>
    </div>
  )
}

function ScanOverview({ scan }: { scan: GoldenStockScan }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: 'Universe', value: scan.universe_scanned, color: 'text-indigo-600' },
        { label: 'Pass 1 Filter', value: scan.passed_filter, color: 'text-amber-600' },
        { label: 'Intraday Picks', value: scan.picks.length, color: 'text-emerald-600' },
        { label: 'Last Scan', value: fmtTime(scan.scan_time), color: 'text-zinc-600', isText: true },
      ].map(({ label, value, color, isText }) => (
        <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${color} dark:opacity-90 ${isText ? 'text-sm' : ''}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

const HISTORY_RANGES: { label: string; limit: number }[] = [
  { label: '1D', limit: 1 },
  { label: '1W', limit: 7 },
  { label: '1M', limit: 30 },
  { label: '3M', limit: 90 },
]

function HistoryTable({
  history, selectedDate, onSelect,
}: {
  history: GoldenStockHistoryItem[]
  selectedDate: string | null
  onSelect: (date: string) => void
}) {
  if (history.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            {['Date', 'Scan Time', 'Universe', 'Pass 1', 'Picks', 'Top Pick', 'Score'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map(row => (
            <tr
              key={row.id}
              onClick={() => onSelect(row.scan_date)}
              className={`cursor-pointer border-b border-zinc-100 hover:bg-indigo-50/60 dark:border-zinc-800 dark:hover:bg-indigo-950/30 ${
                selectedDate === row.scan_date ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''
              }`}
            >
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{row.scan_date}</td>
              <td className="px-4 py-3 text-zinc-500">{fmtTime(row.scan_time)}</td>
              <td className="px-4 py-3 text-zinc-500">{row.universe_scanned}</td>
              <td className="px-4 py-3 text-zinc-500">{row.passed_filter}</td>
              <td className="px-4 py-3 font-semibold text-emerald-600">{row.pick_count}</td>
              <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                {row.top_symbol.replace('.NS', '').replace('.BO', '')}
              </td>
              <td className="px-4 py-3">
                <span className={`font-bold ${
                  row.top_score >= 70 ? 'text-emerald-600' : row.top_score >= 50 ? 'text-amber-500' : 'text-red-500'
                }`}>{row.top_score}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 py-20 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 text-5xl">&#128293;</div>
      <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">No Intraday scan yet</h3>
      <p className="mb-6 text-sm text-zinc-500">Run a scan to find today's top intraday candidates.</p>
      <button
        onClick={onScan}
        disabled={scanning}
        className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {scanning ? 'Scanning...' : 'Run Scan Now'}
      </button>
    </div>
  )
}

export function GoldenStockView() {
  const [scan, setScan] = useState<GoldenStockScan | null>(null)
  const [history, setHistory] = useState<GoldenStockHistoryItem[]>([])
  const [historyLimit, setHistoryLimit] = useState(30)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [userRole, setUserRole] = useState<string>('')
  const [viewedDate, setViewedDate] = useState<string | null>(null)
  const [viewedScan, setViewedScan] = useState<GoldenStockScan | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const tokenRef = useRef('')

  async function load() {
    const token = tokenRef.current
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [latestResult, histResult, wlResult] = await Promise.allSettled([
        getGoldenStockLatest(token),
        getGoldenStockHistory(token, historyLimit),
        listWatchlists(token),
      ])
      if (latestResult.status === 'fulfilled') { setScan(latestResult.value); writePageCache(SCAN_CACHE_KEY, latestResult.value) }
      if (histResult.status === 'fulfilled') setHistory(histResult.value)
      if (wlResult.status === 'fulfilled') setWatchlists(wlResult.value)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory(limit: number) {
    const token = tokenRef.current
    if (!token) return
    try {
      setHistory(await getGoldenStockHistory(token, limit))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSelectDate(date: string) {
    const token = tokenRef.current
    if (!token) return
    if (viewedDate === date) {
      setViewedDate(null)
      setViewedScan(null)
      return
    }
    setViewedDate(date)
    setViewLoading(true)
    setError(null)
    try {
      setViewedScan(await getGoldenStockByDate(token, date))
    } catch (e) {
      setError((e as Error).message)
      setViewedDate(null)
    } finally {
      setViewLoading(false)
    }
  }

  function backToLatest() {
    setViewedDate(null)
    setViewedScan(null)
  }

  async function handleScan() {
    const token = tokenRef.current
    if (!token) return
    setScanning(true)
    setError(null)
    try {
      const result = await triggerGoldenStockScan(token)
      setScan(result)
      backToLatest()
      await loadHistory(historyLimit)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setScanning(false)
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
    // Show the last-known scan instantly (from a previous visit) instead
    // of a blank spinner, then load() below fetches fresh data in the
    // background and overwrites both state and the cache. Deferred a
    // microtask so the setState isn't synchronous within the effect body
    // (react-hooks/set-state-in-effect).
    const cached = readPageCache<GoldenStockScan>(SCAN_CACHE_KEY)
    if (cached) Promise.resolve().then(() => { setScan(cached); setLoading(false) })
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = userRole === 'admin'
  const displayScan = viewedScan ?? scan

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Golden Stock" />
      <div className="mx-auto max-w-7xl px-4 py-8">

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Golden Stock &mdash; Intraday
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              AI-scored intraday picks &nbsp;&middot;&nbsp; Scans ~750 NSE stocks &nbsp;&middot;&nbsp; Updated daily at 3:00 PM IST
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={handleScan}
              disabled={scanning || loading}
              className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Run Scan Now'}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-72 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
              ))}
            </div>
          </div>
        ) : scan === null ? (
          <EmptyState onScan={handleScan} scanning={scanning} />
        ) : (
          <div className="space-y-6">
            {viewedDate && (
              <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
                <span className="font-medium text-indigo-700 dark:text-indigo-300">
                  Viewing historical scan &middot; {viewedDate}
                </span>
                <button
                  onClick={backToLatest}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-zinc-800"
                >
                  &larr; Back to Latest
                </button>
              </div>
            )}

            {viewLoading || !displayScan ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-72 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
                ))}
              </div>
            ) : (
              <>
                <ScanOverview scan={displayScan} />

                {displayScan.picks.length === 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-800 dark:bg-amber-950/20">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      Scan ran but no stocks passed the Intraday hard filters (score &ge; 45, vol &ge; 1.5x, near day high, above SMA20).
                    </p>
                    {isAdmin && !viewedDate && (
                      <button
                        onClick={handleScan}
                        disabled={scanning}
                        className="mt-4 rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        Run Another Scan
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      Top {displayScan.picks.length} Intraday Picks &nbsp;
                      <span className="font-normal text-zinc-400">&middot; {displayScan.scan_date}</span>
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {displayScan.picks.map(pick => (
                        <PickCard
                          key={pick.symbol}
                          pick={pick}
                          token={tokenRef.current}
                          watchlists={watchlists}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {history.length > 0 && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Scan History &nbsp;
                    <span className="font-normal text-zinc-400">&middot; click a row to view that day&apos;s picks</span>
                  </h2>
                  <div className="flex gap-1">
                    {HISTORY_RANGES.map(r => (
                      <button
                        key={r.label}
                        onClick={() => { setHistoryLimit(r.limit); loadHistory(r.limit) }}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                          historyLimit === r.limit
                            ? 'bg-amber-500 text-white'
                            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <HistoryTable history={history} selectedDate={viewedDate} onSelect={handleSelectDate} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

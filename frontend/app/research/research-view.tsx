'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { marketScan, addToWatchlist } from '@/lib/api'
import type { ScanResult } from '@/lib/api'

type FilterType = 'both' | 'momentum' | 'value'
type Universe = 'nifty50' | 'nifty100'
type SortKey = 'signal' | 'price' | 'change_pct' | 'rsi' | 'momentum_score' | 'value_score' | 'combined_score'
type SortDir = 'asc' | 'desc'

const SIGNAL_RANK: Record<string, number> = { BUY: 3, HOLD: 2, SELL: 1 }

function sortResults(arr: ScanResult[], key: SortKey, dir: SortDir): ScanResult[] {
  return [...arr].sort((a, b) => {
    const av = key === 'signal' ? (SIGNAL_RANK[a.signal] ?? 0) : (a[key] as number)
    const bv = key === 'signal' ? (SIGNAL_RANK[b.signal] ?? 0) : (b[key] as number)
    return dir === 'desc' ? bv - av : av - bv
  })
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-zinc-500">{value}</span>
    </div>
  )
}

function SignalBadge({ signal }: { signal: string }) {
  const cls =
    signal === 'BUY'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
      : signal === 'SELL'
        ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
        : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls}`}>
      {signal}
    </span>
  )
}

function SortTh({
  label, col, sortKey, sortDir, onSort, right,
}: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: SortDir
  onSort: (c: SortKey) => void; right?: boolean
}) {
  const active = sortKey === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`cursor-pointer select-none px-4 py-3 text-xs font-medium transition-colors ${right ? 'text-right' : 'text-left'} ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
    >
      {label} {active ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
    </th>
  )
}

export default function ResearchView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [results, setResults] = useState<ScanResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>('both')
  const [universe, setUniverse] = useState<Universe>('nifty50')
  const [addedSymbols, setAddedSymbols] = useState<Set<string>>(new Set())
  const [authChecked, setAuthChecked] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('combined_score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const id = setTimeout(() => setAuthChecked(true), 0)
    return () => clearTimeout(id)
  }, [router])

  const runScan = useCallback(async () => {
    setLoading(true); setError(null); setResults([]); setElapsed(0)
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    try {
      const data = await marketScan(tokenRef.current, filter, universe, 20)
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
      clearInterval(timer)
    }
  }, [filter, universe])

  async function handleAddWatchlist(symbol: string) {
    try {
      await addToWatchlist(tokenRef.current, symbol)
      setAddedSymbols(prev => new Set([...prev, symbol]))
    } catch { setAddedSymbols(prev => new Set([...prev, symbol])) }
  }

  function handleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(col)
      setSortDir('desc')
    }
  }

  if (!authChecked) return null

  const displayed = sortResults(results, sortKey, sortDir)
  const buyCount = results.filter(r => r.signal === 'BUY').length
  const sellCount = results.filter(r => r.signal === 'SELL').length

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Research" />
      <main className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Market Research Agent</h1>
          <p className="text-xs text-zinc-400">
            Scans Nifty 50 / Next 50 universe · scores on momentum (RSI, MACD, SMA trend, volume) and value (52-week position, oversold level)
          </p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
            {(['both', 'momentum', 'value'] as FilterType[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
                {f === 'both' ? 'Momentum + Value' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
            {(['nifty50', 'nifty100'] as Universe[]).map(u => (
              <button key={u} onClick={() => setUniverse(u)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${universe === u ? 'bg-zinc-800 text-white dark:bg-zinc-600' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
                {u === 'nifty50' ? 'Nifty 50' : 'Nifty 100'}
              </button>
            ))}
          </div>

          <button onClick={runScan} disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? `Scanning… ${elapsed}s` : 'Scan Market'}
          </button>

          {results.length > 0 && (
            <span className="text-xs text-zinc-400">
              {results.length} stocks · <span className="text-emerald-700 dark:text-emerald-400">{buyCount} BUY</span> · <span className="text-red-600 dark:text-red-400">{sellCount} SELL</span>
            </span>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Fetching 1 year of data for {universe === 'nifty50' ? '50' : '70'} stocks in parallel and computing technical scores… typically 30–60 seconds.
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {!loading && results.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">Click <strong>Scan Market</strong> to scan the Nifty universe for trading opportunities.</p>
            <p className="mt-1 text-xs text-zinc-400">
              Stocks are ranked by a combined score of momentum (60%) and value (40%).
            </p>
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Symbol</th>
                  <SortTh label="Signal" col="signal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Price" col="price" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                  <SortTh label="Chg%" col="change_pct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                  <SortTh label="RSI" col="rsi" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Momentum" col="momentum_score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Value" col="value_score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Score" col="combined_score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Rationale</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((r, i) => {
                  const sym = r.symbol.replace(/\.(NS|BO)$/, '')
                  const isAdded = addedSymbols.has(r.symbol)
                  const scoreColor = r.combined_score >= 65 ? 'text-emerald-700 dark:text-emerald-400'
                    : r.combined_score <= 38 ? 'text-red-600 dark:text-red-400'
                    : 'text-zinc-700 dark:text-zinc-300'

                  return (
                    <tr key={r.symbol} className="border-b border-zinc-50 hover:bg-zinc-50/60 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">{sym}</p>
                        <p className="max-w-[80px] truncate text-[10px] text-zinc-400">{r.name}</p>
                      </td>
                      <td className="px-4 py-3"><SignalBadge signal={r.signal} /></td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-900 dark:text-zinc-50">₹{r.price.toLocaleString('en-IN')}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${r.change_pct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {r.change_pct >= 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-mono ${r.rsi > 65 ? 'text-red-600 dark:text-red-400' : r.rsi < 35 ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-300'}`}>
                          {r.rsi.toFixed(0)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={r.momentum_score} color="bg-blue-500" />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={r.value_score} color="bg-amber-400" />
                      </td>
                      <td className={`px-4 py-3 font-semibold tabular-nums ${scoreColor}`}>
                        {r.combined_score.toFixed(0)}
                      </td>
                      <td className="max-w-[180px] px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.rationale.map((tag, ti) => (
                            <span key={ti} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleAddWatchlist(r.symbol)} disabled={isAdded}
                            className={`rounded px-2 py-1 text-[10px] font-medium ${isAdded ? 'text-zinc-300 dark:text-zinc-600' : 'text-indigo-600 hover:text-indigo-500 dark:text-indigo-400'}`}>
                            {isAdded ? '✓ Added' : '+ Watch'}
                          </button>
                          <Link href={`/ai?symbol=${encodeURIComponent(r.symbol)}`}
                            className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                            AI →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

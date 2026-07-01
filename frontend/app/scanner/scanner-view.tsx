'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { getScanCatalog, runMarketScan } from '@/lib/api'
import type { ScanCatalogItem, ScanResponse, ScanResultItem } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtVol(n: number) {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(2)} Cr`
  if (n >= 1_00_000)   return `${(n / 1_00_000).toFixed(2)} L`
  return n.toLocaleString('en-IN')
}

const CAT_ICON: Record<string, string> = {
  'Volume & Breakout': '📊',
  'Price Action':      '⚡',
  'Oscillators':       '〰️',
  'Trend':             '📈',
  'Momentum':          '🚀',
  'Institutional':     '🏦',
}

const SIG_STYLE: Record<string, string> = {
  BUY:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
  SELL:    'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300',
  NEUTRAL: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

// ── Grouped catalog sidebar ───────────────────────────────────────────────────

function Sidebar({
  catalog, active, onSelect,
}: {
  catalog: ScanCatalogItem[]
  active: string
  onSelect: (id: string) => void
}) {
  const groups: Record<string, ScanCatalogItem[]> = {}
  for (const item of catalog) {
    ;(groups[item.category] ??= []).push(item)
  }

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="p-3">
        <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Scan Types
        </p>
        {Object.entries(groups).map(([cat, items]) => (
          <div key={cat} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              {CAT_ICON[cat]} {cat}
            </p>
            {items.map(item => (
              <button
                key={item.id}
                disabled={!item.available}
                onClick={() => item.available && onSelect(item.id)}
                title={item.desc}
                className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  active === item.id
                    ? 'bg-indigo-600 text-white'
                    : item.available
                    ? 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    : 'cursor-not-allowed text-zinc-400 dark:text-zinc-600'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span>{item.name}</span>
                  {!item.available && (
                    <span className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                      PRO
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── Results panel ─────────────────────────────────────────────────────────────

type SortKey = 'cmp' | 'change_pct' | 'volume' | 'vol_ratio' | 'rsi'

function ResultsPanel({
  response, loading, elapsed,
}: {
  response: ScanResponse | null
  loading: boolean
  elapsed: number
}) {
  const [sortKey, setSortKey] = useState<SortKey>('change_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const rows = response?.results
    ? [...response.results].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        return sortDir === 'desc' ? bv - av : av - bv
      })
    : []

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Scanning {response === null ? '70+' : ''} stocks…
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            First scan fetches 6 months of data for each stock — usually 30–60 seconds.
            <br />Results are cached for 5 minutes.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          {elapsed}s elapsed
        </div>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-indigo-50 p-6 dark:bg-indigo-950/30">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.5} className="text-indigo-400">
            <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Select a scan type to begin
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Choose from 12 technical scans in the left panel
          </p>
        </div>
      </div>
    )
  }

  if (!response.available) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {response.name} — Premium Feature
          </p>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 max-w-xs">
            {response.note}
          </p>
          <p className="mt-3 text-[10px] text-amber-600 dark:text-amber-500">
            Integration with NSE data APIs planned for Phase 2
          </p>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          No stocks matched this scan
        </p>
        <p className="text-xs text-zinc-400">
          Scanned {response.universe ?? 70} stocks · Try again after market hours for fresh data
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{response.name}</h2>
          <p className="text-[11px] text-zinc-400">
            {rows.length} stock{rows.length !== 1 ? 's' : ''} matched
            {response.universe && ` · ${response.universe} scanned`}
            {response.cached && (
              <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-800">
                CACHED
              </span>
            )}
          </p>
        </div>
        <div className="text-[11px] text-zinc-400">
          Sorted by <span className="font-medium text-zinc-600 dark:text-zinc-300">{sortKey.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900">
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Symbol / Company</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Sector</th>
              {(['cmp', 'change_pct', 'volume', 'vol_ratio', 'rsi'] as SortKey[]).map(k => (
                <th key={k}
                  onClick={() => handleSort(k)}
                  className={`cursor-pointer select-none px-4 py-3 text-right text-xs font-medium hover:text-zinc-700 dark:hover:text-zinc-200 ${
                    sortKey === k ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
                  }`}
                >
                  {k === 'cmp' ? 'CMP ₹'
                    : k === 'change_pct' ? 'Chg %'
                    : k === 'vol_ratio' ? 'Vol Ratio'
                    : k === 'volume' ? 'Volume'
                    : 'RSI'}
                  {sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Key Signal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Signal</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <ScanRow key={r.symbol} rank={i + 1} item={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScanRow({ rank, item: r }: { rank: number; item: ScanResultItem }) {
  const sym = r.symbol.replace(/\.(NS|BO)$/, '')
  const chgColor = r.change_pct >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-500 dark:text-red-400'

  return (
    <tr className={`border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${rank % 2 === 0 ? 'bg-zinc-50/30 dark:bg-zinc-800/10' : ''}`}>
      <td className="px-4 py-3 text-xs text-zinc-400">{rank}</td>

      <td className="px-4 py-3">
        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
        <p className="max-w-[160px] truncate text-[10px] text-zinc-400">{r.name}</p>
      </td>

      <td className="px-4 py-3">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {r.sector}
        </span>
      </td>

      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
        ₹{fmt(r.cmp)}
      </td>

      <td className={`px-4 py-3 text-right text-xs font-semibold ${chgColor}`}>
        {r.change_pct >= 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
      </td>

      <td className="px-4 py-3 text-right text-xs text-zinc-500 dark:text-zinc-400">
        {fmtVol(r.volume)}
      </td>

      <td className="px-4 py-3 text-right text-xs">
        <span className={`font-semibold ${r.vol_ratio >= 2 ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {r.vol_ratio.toFixed(1)}×
        </span>
      </td>

      <td className="px-4 py-3 text-right text-xs">
        <span className={
          r.rsi <= 35 ? 'font-semibold text-emerald-600 dark:text-emerald-400'
          : r.rsi >= 65 ? 'font-semibold text-red-500 dark:text-red-400'
          : 'text-zinc-500 dark:text-zinc-400'
        }>
          {r.rsi.toFixed(0)}
        </span>
      </td>

      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
        {r.key_metric}
      </td>

      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${SIG_STYLE[r.signal] ?? SIG_STYLE.NEUTRAL}`}>
          {r.signal}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex gap-2">
          <Link href={`/forecast?symbol=${sym}`}
            className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 whitespace-nowrap">
            Forecast →
          </Link>
          <Link href={`/paper?symbol=${r.symbol}&signal=${r.signal === 'SELL' ? 'SELL' : 'BUY'}`}
            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 whitespace-nowrap dark:text-emerald-400">
            Trade →
          </Link>
        </div>
      </td>
    </tr>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ScannerView() {
  const router = useRouter()
  const tokenRef = useRef('')

  const [catalog, setCatalog]   = useState<ScanCatalogItem[]>([])
  const [activeScan, setActive] = useState<string>('')
  const [response, setResponse] = useState<ScanResponse | null>(null)
  const [loading, setLoading]   = useState(false)
  const [elapsed, setElapsed]   = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getScanCatalog(t)
      .then(setCatalog)
      .catch(() => router.replace('/login'))
  }, [router])

  const runScan = useCallback(async (scanId: string) => {
    setActive(scanId)
    setResponse(null)
    setLoading(true)
    setElapsed(0)

    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

    try {
      const res = await runMarketScan(tokenRef.current, scanId, 25)
      setResponse(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const activeMeta = catalog.find(c => c.id === activeScan)

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Markets" />

      {/* Top bar */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Market Scanner</h1>
            <p className="text-[11px] text-zinc-400">
              Technical scans across {' '}
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                Nifty 50 + Next 50
              </span>
              {' '}universe · Powered by yfinance · Data may lag by 1 day
            </p>
          </div>
          {activeMeta && !loading && response && (
            <button onClick={() => runScan(activeScan)}
              className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30">
              ↺ Refresh
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {catalog.length > 0 && (
          <Sidebar catalog={catalog} active={activeScan} onSelect={runScan} />
        )}

        {catalog.length === 0 && (
          <aside className="w-60 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="p-4 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-7 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
          </aside>
        )}

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-900">
          <ResultsPanel response={response} loading={loading} elapsed={elapsed} />
        </main>
      </div>
    </div>
  )
}

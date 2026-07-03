'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import {
  getScanCatalog, runMarketScan,
  listWatchlists, createWatchlist, deleteWatchlist,
  getWatchlistItems, addItemToWatchlist, removeFromWatchlist,
  searchStocks,
} from '@/lib/api'
import type { ScanCatalogItem, ScanResponse, ScanResultItem, Watchlist, WatchlistItem, StockSearchResult } from '@/lib/api'

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
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-semibold text-zinc-500">No stocks matched this scan</p>
        <p className="text-xs text-zinc-400">Try a different scan type or check back during market hours</p>
      </div>
    )
  }

  function Th({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k
    return (
      <th onClick={() => handleSort(k)}
        className="cursor-pointer select-none px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
        {label} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}
      </th>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        {response.count} result{response.count !== 1 ? 's' : ''} · {response.universe} scanned
        {response.cached && <span className="ml-2 text-indigo-400">· cached</span>}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Symbol</th>
              <Th label="Price" k="cmp" />
              <Th label="Chg %" k="change_pct" />
              <Th label="Volume" k="volume" />
              <Th label="Vol ×" k="vol_ratio" />
              <Th label="RSI" k="rsi" />
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Signal</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <ResultRow key={r.symbol} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultRow({ r }: { r: ScanResultItem }) {
  const sym = r.symbol.replace('.NS', '').replace('.BO', '')
  const chgPos = r.change_pct >= 0

  return (
    <tr className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
      <td className="px-4 py-3">
        <div className="font-semibold text-zinc-900 dark:text-zinc-50">{sym}</div>
        <div className="text-[10px] text-zinc-400">{r.sector}</div>
      </td>

      <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-200">
        ₹{fmt(r.cmp)}
      </td>

      <td className={`px-4 py-3 font-mono text-xs font-semibold ${chgPos ? 'text-emerald-600' : 'text-red-500'}`}>
        {chgPos ? '+' : ''}{r.change_pct.toFixed(2)}%
      </td>

      <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
        {fmtVol(r.volume)}
      </td>

      <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
        {r.vol_ratio.toFixed(2)}×
      </td>

      <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
        {r.rsi ? r.rsi.toFixed(1) : '—'}
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

// ── Watchlists panel ──────────────────────────────────────────────────────────

function WatchlistsPanel({ token }: { token: string }) {
  const [watchlists, setWatchlists]   = useState<Watchlist[]>([])
  const [activeWl, setActiveWl]       = useState<string | null>(null)
  const [items, setItems]             = useState<WatchlistItem[]>([])
  const [newName, setNewName]         = useState('')
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [creating, setCreating]       = useState(false)
  const [adding, setAdding]           = useState(false)
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(true)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    listWatchlists(token).then(wls => {
      setWatchlists(wls)
      if (wls.length > 0) setActiveWl(wls[0].id.toString())
      setLoading(false)
    })
  }, [token])

  useEffect(() => {
    if (!activeWl) return
    getWatchlistItems(token, activeWl).then(setItems)
  }, [token, activeWl])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const wl = await createWatchlist(token, newName.trim())
      setWatchlists(prev => [...prev, wl])
      setActiveWl(wl.id.toString())
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  function handleQueryChange(val: string) {
    setQuery(val)
    setSelectedSymbol('')
    if (searchRef.current) clearTimeout(searchRef.current)
    if (val.trim().length < 2) { setSuggestions([]); return }
    searchRef.current = setTimeout(() => {
      searchStocks(token, val).then(setSuggestions)
    }, 250)
  }

  function handleSelect(r: StockSearchResult) {
    setSelectedSymbol(r.symbol)
    setQuery(`${r.symbol.replace('.NS','').replace('.BO','')} — ${r.name}`)
    setSuggestions([])
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const sym = selectedSymbol || query.trim().toUpperCase()
    if (!sym || !activeWl) return
    setAdding(true)
    setError('')
    try {
      const item = await addItemToWatchlist(token, activeWl, sym)
      setItems(prev => [...prev, item])
      setQuery('')
      setSelectedSymbol('')
    } catch {
      setError('Symbol not found or already in watchlist')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(symbol: string) {
    if (!activeWl) return
    await removeFromWatchlist(token, symbol)
    setItems(prev => prev.filter(i => i.symbol !== symbol))
  }

  async function handleDeleteWl(id: string) {
    await deleteWatchlist(token, id)
    const updated = watchlists.filter(w => w.id.toString() !== id)
    setWatchlists(updated)
    if (activeWl === id) setActiveWl(updated[0]?.id.toString() ?? null)
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading watchlists…</div>
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Watchlist list sidebar */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="p-3">
          <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">My Watchlists</p>
          {watchlists.length === 0 && (
            <p className="px-2 text-xs text-zinc-400">No watchlists yet</p>
          )}
          {watchlists.map(wl => (
            <div key={wl.id.toString()}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${
                activeWl === wl.id.toString()
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
              onClick={() => setActiveWl(wl.id.toString())}
            >
              <span className="truncate font-medium">{wl.name}</span>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteWl(wl.id.toString()) }}
                className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"
                title="Delete watchlist"
              >
                ×
              </button>
            </div>
          ))}

          {/* Create watchlist */}
          <form onSubmit={handleCreate} className="mt-3 flex gap-1">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New watchlist…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              +
            </button>
          </form>
        </div>
      </aside>

      {/* Watchlist items */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-900">
        {!activeWl ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            Create a watchlist to get started
          </div>
        ) : (
          <>
            {/* Add symbol bar */}
            <div className="shrink-0 border-b border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
              <form onSubmit={handleAdd} className="relative flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    value={query}
                    onChange={e => handleQueryChange(e.target.value)}
                    placeholder="Search symbol (e.g. INFY, Reliance…)"
                    autoComplete="off"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                  {suggestions.length > 0 && (
                    <ul className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                      {suggestions.map(r => (
                        <li key={r.symbol}>
                          <button
                            type="button"
                            onClick={() => handleSelect(r)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                          >
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {r.symbol.replace('.NS','').replace('.BO','')}
                            </span>
                            <span className="ml-2 truncate text-zinc-400">{r.name}</span>
                            <span className="ml-2 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-500 dark:bg-zinc-800">
                              {r.exchange}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={adding || (!selectedSymbol && query.trim().length < 2)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add'}
                </button>
                {error && <span className="text-xs text-red-500">{error}</span>}
              </form>
            </div>

            {/* Items table */}
            {items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
                No stocks in this watchlist yet
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Symbol</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Exchange</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Added</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const sym = item.symbol.replace('.NS', '').replace('.BO', '')
                      return (
                        <tr key={item.symbol} className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                          <td className="px-4 py-3">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{sym}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500">{item.exchange}</td>
                          <td className="px-4 py-3 text-xs text-zinc-400">
                            {item.added_at ? new Date(item.added_at).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-3">
                              <Link href={`/forecast?symbol=${sym}`}
                                className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700">
                                Forecast →
                              </Link>
                              <Link href={`/paper?symbol=${item.symbol}&signal=BUY`}
                                className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400">
                                Trade →
                              </Link>
                              <button
                                onClick={() => handleRemove(item.symbol)}
                                className="text-[10px] font-semibold text-red-400 hover:text-red-600"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-[11px] text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
                  {items.length} stocks
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ScannerView() {
  const router = useRouter()
  const tokenRef = useRef('')

  const [tab, setTab]            = useState<'scanner' | 'watchlists'>('scanner')
  const [catalog, setCatalog]    = useState<ScanCatalogItem[]>([])
  const [activeScan, setActive]  = useState<string>('')
  const [response, setResponse]  = useState<ScanResponse | null>(null)
  const [loading, setLoading]    = useState(false)
  const [elapsed, setElapsed]    = useState(0)
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

  const TAB_CLS = (t: typeof tab) =>
    `px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
      tab === t
        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
        : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Markets" />

      {/* Top bar */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between py-3">
          <div>
            <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Market Scanner</h1>
            <p className="text-[11px] text-zinc-400">
              Technical scans across{' '}
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">Nifty 50 + Next 50</span>
              {' '}universe · Powered by yfinance · Data may lag by 1 day
            </p>
          </div>
          {tab === 'scanner' && activeMeta && !loading && response && (
            <button onClick={() => runScan(activeScan)}
              className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30">
              ↺ Refresh
            </button>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1 -mb-px">
          <button className={TAB_CLS('scanner')} onClick={() => setTab('scanner')}>Scanner</button>
          <button className={TAB_CLS('watchlists')} onClick={() => setTab('watchlists')}>Watchlists</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {tab === 'scanner' ? (
          <>
            {catalog.length > 0 ? (
              <Sidebar catalog={catalog} active={activeScan} onSelect={runScan} />
            ) : (
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
          </>
        ) : (
          <WatchlistsPanel token={tokenRef.current} />
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { LiveTicker } from '@/components/live-ticker'
import {
  listWatchlists, createWatchlist, deleteWatchlist,
  getWatchlistItems, addItemToWatchlist, removeItemFromWatchlist,
  searchStocks, getWatchlistQuotes,
} from '@/lib/api'
import type { Watchlist, WatchlistItem, StockSearchResult, WatchlistQuote } from '@/lib/api'

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtVol(n: number) {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(2)} Cr`
  if (n >= 1_00_000)   return `${(n / 1_00_000).toFixed(2)} L`
  return n.toLocaleString('en-IN')
}

function fmtINR(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const TREND_CLS: Record<string, string> = {
  BULLISH: 'text-emerald-600 dark:text-emerald-400',
  BEARISH: 'text-red-500 dark:text-red-400',
  MIXED:   'text-amber-500 dark:text-amber-400',
}

function MaDot({ above }: { above: boolean | null }) {
  if (above === null) return <span className="text-zinc-300">·</span>
  return <span className={above ? 'text-emerald-500' : 'text-red-500'}>{above ? '▲' : '▼'}</span>
}

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
]

function SymbolAvatar({ symbol }: { symbol: string }) {
  const letters = symbol.replace('.NS', '').replace('.BO', '').slice(0, 2).toUpperCase()
  const idx = letters.charCodeAt(0) % AVATAR_COLORS.length
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${AVATAR_COLORS[idx]}`}>
      {letters}
    </span>
  )
}

function WatchlistsPanel({ token }: { token: string }) {
  const [watchlists, setWatchlists]   = useState<Watchlist[]>([])
  const [activeWl, setActiveWl]       = useState<string | null>(null)
  const [items, setItems]             = useState<WatchlistItem[]>([])
  const [quotes, setQuotes]           = useState<WatchlistQuote[]>([])
  const [quotesLoading, setQLoading]  = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [newName, setNewName]         = useState('')
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [creating, setCreating]       = useState(false)
  const [adding, setAdding]           = useState(false)
  const [addError, setAddError]       = useState('')
  const [loading, setLoading]         = useState(true)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    listWatchlists(token).then(wls => {
      setWatchlists(wls)
      if (wls.length > 0) setActiveWl(wls[0].id.toString())
      setLoading(false)
    })
  }, [token])

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasDataRef = useRef(false)

  useEffect(() => {
    if (!activeWl) return
    const cacheKey = `mts_wl_quotes_${activeWl}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        setQuotes(JSON.parse(cached))
        hasDataRef.current = true
      } catch { /* ignore */ }
    } else {
      setQuotes([])
      hasDataRef.current = false
    }
    getWatchlistItems(token, activeWl).then(setItems)
  }, [token, activeWl])

  useEffect(() => {
    if (!activeWl || items.length === 0) return
    loadQuotes()
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    refreshIntervalRef.current = setInterval(loadQuotes, 30000)
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  async function loadQuotes() {
    if (!activeWl) return
    const showSpinner = !hasDataRef.current
    if (showSpinner) setQLoading(true)
    try {
      const q = await getWatchlistQuotes(token, activeWl)
      setQuotes(q)
      setLastUpdated(new Date())
      hasDataRef.current = true
      localStorage.setItem(`mts_wl_quotes_${activeWl}`, JSON.stringify(q))
    } catch {
      // keep previous quotes
    } finally {
      if (showSpinner) setQLoading(false)
    }
  }

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
    setAddError('')
    try {
      const item = await addItemToWatchlist(token, activeWl, sym)
      setItems(prev => [...prev, item])
      setQuery('')
      setSelectedSymbol('')
    } catch {
      setAddError('Symbol not found or already in watchlist')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(symbol: string) {
    if (!activeWl) return
    await removeItemFromWatchlist(token, activeWl, symbol)
    setItems(prev => prev.filter(i => i.symbol !== symbol))
    setQuotes(prev => prev.filter(q => q.symbol !== symbol))
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

  const quoteMap = new Map(quotes.map(q => [q.symbol, q]))

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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
              >×</button>
            </div>
          ))}
          <form onSubmit={handleCreate} className="mt-3 flex gap-1">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New watchlist…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button type="submit" disabled={creating || !newName.trim()}
              className="rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">+</button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-900">
        {!activeWl ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Create a watchlist to get started</div>
        ) : (
          <>
            {/* Toolbar */}
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
                          <button type="button" onClick={() => handleSelect(r)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {r.symbol.replace('.NS','').replace('.BO','')}
                            </span>
                            <span className="ml-2 truncate text-zinc-400">{r.name}</span>
                            <span className="ml-2 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-500 dark:bg-zinc-800">{r.exchange}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button type="submit" disabled={adding || (!selectedSymbol && query.trim().length < 2)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {adding ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={loadQuotes} disabled={quotesLoading}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {quotesLoading ? 'Refreshing…' : '↻ Refresh'}
                </button>
                {addError && <span className="text-xs text-red-500">{addError}</span>}
                {lastUpdated && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                    {!quotesLoading && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" title="Auto-refreshing every 30s" />
                    )}
                    {quotesLoading ? 'Refreshing…' : `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                  </span>
                )}
              </form>
            </div>

            {/* Live ticker */}
            {items.length > 0 && (
              <div className="px-4 pt-3">
                <LiveTicker symbols={items.map(i => i.symbol)} token={token} />
              </div>
            )}

            {/* Table */}
            {items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">No stocks in this watchlist yet</div>
            ) : quotesLoading && quotes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                <p className="text-sm text-zinc-500">Fetching market data for {items.length} stocks…</p>
                <p className="text-xs text-zinc-400">
                  First load downloads 1 year of data from yfinance — takes 30–90s for large watchlists.
                  Subsequent loads are instant (5-min cache).
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="min-w-max border-collapse text-[11px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th colSpan={6} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-zinc-500 dark:border-zinc-700">Identity</th>
                      <th colSpan={5} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-indigo-500">Price Action</th>
                      <th colSpan={4} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-blue-500">Intraday</th>
                      <th colSpan={3} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-violet-500">Volume Analysis</th>
                      <th colSpan={4} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-amber-500">52-Week Range</th>
                      <th colSpan={4} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-emerald-600">Trend Analysis</th>
                      <th colSpan={4} className="border-b border-r border-zinc-200 px-3 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-rose-500">Technical Indicators</th>
                      <th className="border-b border-zinc-200 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400">Actions</th>
                    </tr>
                    <tr className="bg-zinc-50 dark:bg-zinc-900">
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 dark:border-zinc-700 whitespace-nowrap">Symbol</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Company</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Exch</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Sector</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Cap</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Index</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">LTP</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Prev Close</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Chg ₹</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Chg %</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Open</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Day High</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Day Low</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">VWAP</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">ATP</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Volume</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Avg Vol</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Vol ×</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">52W H</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">52W L</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">% from H</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">% from L</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">SMA20</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">SMA50</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">SMA200</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Trend</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">RSI</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">MACD</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">Signal</th>
                      <th className="border-b border-r border-zinc-200 px-3 py-2 text-right font-bold text-zinc-500 whitespace-nowrap">BB%</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-bold text-zinc-500 whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const q = quoteMap.get(item.symbol)
                      const sym = item.symbol.replace('.NS', '').replace('.BO', '')
                      const pos = q ? q.change_pct >= 0 : null
                      const bbRange = q ? (q.bb_upper - q.bb_lower) : 0
                      const bbPct = q && bbRange > 0
                        ? Math.round((q.ltp - q.bb_lower) / bbRange * 100)
                        : null

                      return (
                        <tr key={item.symbol}
                          className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <SymbolAvatar symbol={item.symbol} />
                              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{sym}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 max-w-[140px] truncate text-zinc-600 dark:text-zinc-300 whitespace-nowrap" title={q?.company_name ?? sym}>
                            {q?.company_name ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{q?.exchange ?? item.exchange}</td>
                          <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{q?.sector ?? '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {q?.market_cap_category === 'Large' && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">Large</span>}
                            {q?.market_cap_category === 'Mid'   && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Mid</span>}
                            {q?.market_cap_category === 'Small' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Small</span>}
                            {(!q || !q.market_cap_category || q.market_cap_category === '—') && <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="border-r border-zinc-100 px-3 py-2 dark:border-zinc-800 whitespace-nowrap">
                            <div className="flex flex-wrap gap-0.5">
                              {(q?.index_membership ?? ['—']).filter(i => i !== '—').map(idx => (
                                <span key={idx} className="rounded bg-zinc-100 px-1 py-0.5 text-[8px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                  {idx.replace('Nifty ', 'N').replace('Next ', 'Nx').replace('Midcap ', 'M').replace('Smallcap ', 'S').replace('Bank ', 'Bk')}
                                </span>
                              ))}
                              {(!q || !q.index_membership || q.index_membership.every(i => i === '—')) && <span className="text-zinc-300">—</span>}
                            </div>
                          </td>

                          {q && !q.error ? (
                            <>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-900 dark:text-zinc-50 whitespace-nowrap">{fmtINR(q.ltp)}</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">{fmtINR(q.prev_close)}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                                {q.change >= 0 ? '+' : ''}{fmt(q.change)}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
                                {q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%
                              </td>
                              <td className="border-r border-zinc-100 px-3 py-2 text-right font-mono text-zinc-500 dark:border-zinc-800 whitespace-nowrap">{fmtINR(q.open)}</td>
                              <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{fmtINR(q.day_high)}</td>
                              <td className="px-3 py-2 text-right font-mono text-red-500 dark:text-red-400 whitespace-nowrap">{fmtINR(q.day_low)}</td>
                              <td className="px-3 py-2 text-right font-mono text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{fmtINR(q.vwap)}</td>
                              <td className="border-r border-zinc-100 px-3 py-2 text-right font-mono text-zinc-500 dark:border-zinc-800 whitespace-nowrap">{fmtINR(q.atp)}</td>
                              <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{fmtVol(q.volume)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400 whitespace-nowrap">{fmtVol(q.avg_volume)}</td>
                              <td className={`border-r border-zinc-100 px-3 py-2 text-right font-mono font-semibold dark:border-zinc-800 whitespace-nowrap ${
                                q.vol_ratio >= 2 ? 'text-rose-600' : q.vol_ratio >= 1.5 ? 'text-amber-500' : 'text-zinc-500'
                              }`}>{q.vol_ratio.toFixed(2)}×</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">{fmtINR(q.week52_high)}</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">{fmtINR(q.week52_low)}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${
                                q.pct_from_52w_high >= -5 ? 'text-emerald-600' : q.pct_from_52w_high >= -15 ? 'text-amber-500' : 'text-red-500'
                              }`}>{q.pct_from_52w_high.toFixed(1)}%</td>
                              <td className={`border-r border-zinc-100 px-3 py-2 text-right font-mono font-semibold dark:border-zinc-800 whitespace-nowrap ${
                                q.pct_from_52w_low >= 50 ? 'text-emerald-600' : 'text-zinc-500'
                              }`}>+{q.pct_from_52w_low.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">
                                <span title={`SMA20: ${fmtINR(q.sma20)}`}><MaDot above={q.above_sma20} /> {fmtINR(q.sma20)}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">
                                <span title={`SMA50: ${fmtINR(q.sma50)}`}><MaDot above={q.above_sma50} /> {fmtINR(q.sma50)}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-500 whitespace-nowrap">
                                <span title={`SMA200: ${fmtINR(q.sma200)}`}><MaDot above={q.above_sma200} /> {fmtINR(q.sma200)}</span>
                              </td>
                              <td className={`border-r border-zinc-100 px-3 py-2 font-semibold dark:border-zinc-800 whitespace-nowrap ${TREND_CLS[q.trend]}`}>{q.trend}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${
                                q.rsi >= 70 ? 'text-red-500' : q.rsi <= 30 ? 'text-emerald-600' : 'text-zinc-500'
                              }`}>{q.rsi.toFixed(1)}</td>
                              <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${q.macd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{q.macd.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-400 whitespace-nowrap">{q.macd_signal.toFixed(2)}</td>
                              <td className={`border-r border-zinc-100 px-3 py-2 text-right font-mono font-semibold dark:border-zinc-800 whitespace-nowrap ${
                                bbPct !== null && bbPct >= 80 ? 'text-red-500' : bbPct !== null && bbPct <= 20 ? 'text-emerald-600' : 'text-zinc-500'
                              }`}>{bbPct !== null ? `${bbPct}%` : '—'}</td>
                            </>
                          ) : (
                            <td colSpan={22} className="px-3 py-2 text-zinc-300 dark:text-zinc-600">
                              {quotesLoading ? 'Loading…' : (q?.error ?? 'No data')}
                            </td>
                          )}

                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Link href={`/forecast?symbol=${sym}`}
                                className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700">Forecast →</Link>
                              <Link href={`/paper?symbol=${item.symbol}&signal=BUY`}
                                className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400">Trade →</Link>
                              <button onClick={() => handleRemove(item.symbol)}
                                className="text-[10px] font-semibold text-red-400 hover:text-red-600">✕</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="border-t border-zinc-100 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-800">
                  {items.length} stocks · Auto-refreshes every 30s · VWAP/ATP = (H+L+C)/3 and (O+H+L+C)/4 approx · Data via yfinance · Server cache 60s
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default function WatchlistView() {
  const router = useRouter()
  const [token, setToken] = useState('')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    setToken(t)
  }, [router])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Trading" />
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Watchlists</h1>
        <p className="text-[11px] text-zinc-400">
          Track stocks · Live quotes · Auto-refreshes every 30s · Powered by yfinance
        </p>
      </div>
      <div className="flex min-h-0 flex-1">
        {token ? <WatchlistsPanel token={token} /> : null}
      </div>
    </div>
  )
}

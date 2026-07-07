'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  closeTrade, getHistory, getJournalEntry, getMe, getQuote,
  getSotDSettings, listTrades, listWatchlists, placeTrade, saveJournalEntry, searchStocks, updateSotDSettings,
} from '@/lib/api'
import type { ChartPeriod, HistoryBar, JournalEntry, PlaceTradeBody, SotDSettings, StockSearchResult, Trade, User, Watchlist } from '@/lib/api'
import { AddToWatchlistBtn } from '@/components/add-to-watchlist-btn'
import { PriceChart } from '@/components/price-chart'

// ── Symbol search dropdown ────────────────────────────────────────────────────

function SymbolSearch({
  value, onChange, tokenRef, disabled,
}: {
  value: string; onChange: (sym: string) => void; tokenRef: React.RefObject<string>; disabled: boolean
}) {
  const [q, setQ] = useState(value)
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQ(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      const r = await searchStocks(tokenRef.current, v).catch(() => [] as StockSearchResult[])
      setResults(r)
      setOpen(r.length > 0)
    }, 250)
  }

  function pick(r: StockSearchResult) {
    setQ(r.symbol.replace(/\.(NS|BO)$/, ''))
    onChange(r.symbol)
    setResults([]); setOpen(false)
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        value={q}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search symbol…"
        disabled={disabled}
        className={`w-44 ${INPUT}`}
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.slice(0, 8).map(r => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={() => pick(r)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {r.symbol.replace(/\.(NS|BO)$/, '')}
                </span>
                <span className="ml-2 text-xs text-zinc-400">{r.exchange}</span>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[160px]">{r.name}</p>
              </div>
              <span className="text-[10px] text-zinc-400">{r.sector}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Tab = 'open' | 'closed'
type JournalDraft = { notes: string; rating: number; tags: string }

// DB timestamps are stored as UTC without 'Z' suffix — append it so JS
// parses them as UTC rather than local time.
function parseUTC(ts: string): Date {
  return new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z')
}

function livePnl(trade: Trade, currentPrice: number): number {
  return trade.signal === 'BUY'
    ? (currentPrice - trade.entry_price) * trade.quantity
    : (trade.entry_price - currentPrice) * trade.quantity
}

function PnlCell({ value, pct }: { value: number; pct?: number | null }) {
  const up = value >= 0
  return (
    <div className="inline-flex flex-col items-end">
      <span className={`font-mono text-sm ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {up ? '+' : ''}₹{value.toFixed(2)}
      </span>
      {pct != null && (
        <span className={`font-mono text-[10px] ${up ? 'text-emerald-500 dark:text-emerald-500' : 'text-red-400 dark:text-red-500'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

function calcPnlPct(trade: Trade): number | null {
  if (trade.exit_price == null || trade.entry_price === 0) return null
  const diff = trade.signal === 'BUY'
    ? (trade.exit_price - trade.entry_price) / trade.entry_price * 100
    : (trade.entry_price - trade.exit_price) / trade.entry_price * 100
  return Math.round(diff * 100) / 100
}

function SignalBadge({ signal }: { signal: 'BUY' | 'SELL' }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
      signal === 'BUY'
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
    }`}>
      {signal}
    </span>
  )
}

function TradeTypeBadge({ mode, aiExplanation }: { mode: 'paper' | 'live'; aiExplanation: string | null }) {
  const isAuto = aiExplanation?.includes('SotD auto-trade') ?? false
  const modeLabel = mode === 'paper' ? 'Paper' : 'Live'
  const originLabel = isAuto ? 'Auto' : 'Manual'
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
        mode === 'paper'
          ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
          : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
      }`}>
        {modeLabel}
      </span>
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isAuto
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
      }`}>
        {originLabel}
      </span>
    </div>
  )
}

const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'
const TH = 'px-3 py-3 text-left text-xs font-medium text-zinc-500'
const TH_R = 'px-3 py-3 text-right text-xs font-medium text-zinc-500'
const TD = 'px-3 py-3 text-sm text-zinc-700 dark:text-zinc-300'
const TD_R = 'px-3 py-3 text-right text-sm font-mono text-zinc-700 dark:text-zinc-300'

export default function PaperView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<User | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<Date | null>(null)
  const [pricesRefreshing, setPricesRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [closing, setClosing] = useState<string | null>(null)
  const [manualCloseId, setManualCloseId] = useState<string | null>(null)
  const [manualClosePrice, setManualClosePrice] = useState('')

  // Journal state
  const [journalOpen, setJournalOpen] = useState<string | null>(null)
  const [journalLoaded, setJournalLoaded] = useState<Set<string>>(new Set())
  const [journalDrafts, setJournalDrafts] = useState<Record<string, JournalDraft>>({})
  const [journalSaving, setJournalSaving] = useState<string | null>(null)

  // Form state — initialise from URL params when arriving from Market Pulse / AI pages
  const [signal, setSignal] = useState<'BUY' | 'SELL'>(
    () => searchParams.get('signal') === 'SELL' ? 'SELL' : 'BUY'
  )
  const [symbol, setSymbol] = useState(
    () => searchParams.get('symbol')?.replace(/\.(NS|BO)$/i, '') ?? ''
  )
  const [symbolFull, setSymbolFull] = useState(() => searchParams.get('symbol') ?? '')
  const [stopLoss, setStopLoss] = useState(() => searchParams.get('stop_loss') ?? '')
  const [target, setTarget] = useState(() => searchParams.get('target') ?? '')
  const [quantity, setQuantity] = useState('')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState('')
  const [ltp, setLtp] = useState<number | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [watchlists, setWatchlists] = useState<Watchlist[]>([])

  // Auto-trading toggle
  const [sotdSettings, setSotdSettings] = useState<SotDSettings | null>(null)
  const [autoTradeToggling, setAutoTradeToggling] = useState(false)

  const [chartTradeId, setChartTradeId] = useState<string | null>(null)
  const [chartSymbol, setChartSymbol] = useState<string | null>(null)
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1D')
  const [chartBars, setChartBars] = useState<HistoryBar[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  const fetchPrices = useCallback(async (openTrades: Trade[], isManual = false) => {
    if (openTrades.length === 0) return
    if (isManual) setPricesRefreshing(true)
    const symbols = [...new Set(openTrades.map(t => t.symbol))]
    const results = await Promise.allSettled(symbols.map(s => getQuote(tokenRef.current, s)))
    setPrices(prev => {
      const next = { ...prev }
      results.forEach((r, i) => { if (r.status === 'fulfilled') next[symbols[i]] = r.value.price })
      return next
    })
    setPricesUpdatedAt(new Date())
    if (isManual) setPricesRefreshing(false)
  }, [])

  useEffect(() => {
    if (!chartTradeId || !chartSymbol) return
    setChartLoading(true)
    getHistory(tokenRef.current, chartSymbol, chartPeriod)
      .then(setChartBars)
      .catch(() => setChartBars([]))
      .finally(() => setChartLoading(false))
  }, [chartTradeId, chartSymbol, chartPeriod])

  function toggleChart(tradeId: string, symbol: string) {
    if (chartTradeId === tradeId) { setChartTradeId(null); setChartSymbol(null); return }
    setChartTradeId(tradeId)
    setChartSymbol(symbol)
    setChartPeriod('1D')
  }

  const fetchTrades = useCallback(async () => {
    const all = await listTrades(tokenRef.current)
    setTrades(all)
    await fetchPrices(all.filter(t => t.status === 'open'))
  }, [fetchPrices])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getMe(t).then(setUser).catch(() => {})

    // Show cached trades immediately
    const cached = localStorage.getItem('mts_paper_trades_cache')
    if (cached) {
      try { setTrades(JSON.parse(cached)); setLoading(false) } catch { /* ignore */ }
    }

    getSotDSettings(t).then(setSotdSettings).catch(() => {})
    listWatchlists(t).then(setWatchlists).catch(() => {})

    listTrades(t)
      .then(async (all) => {
        setTrades(all)
        localStorage.setItem('mts_paper_trades_cache', JSON.stringify(all))
        await fetchPrices(all.filter(tr => tr.status === 'open'))
      })
      .catch(() => { localStorage.removeItem('mts_token'); router.replace('/login') })
      .finally(() => setLoading(false))
  }, [router, fetchPrices])

  useEffect(() => {
    const open = trades.filter(t => t.status === 'open')
    if (open.length === 0) return
    const id = setInterval(() => fetchPrices(open), 15000)
    return () => clearInterval(id)
  }, [trades, fetchPrices])

  async function handlePlace(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const sym = symbolFull || (symbol.trim().toUpperCase().endsWith('.NS') || symbol.trim().toUpperCase().endsWith('.BO')
      ? symbol.trim()
      : `${symbol.trim().toUpperCase()}.NS`)
    const body: PlaceTradeBody = {
      symbol: sym,
      signal,
      stop_loss: parseFloat(stopLoss),
      target: parseFloat(target),
      quantity: parseInt(quantity, 10),
      ...(orderType === 'LIMIT' && limitPrice ? { limit_price: parseFloat(limitPrice) } : {}),
    }
    if (!symbol.trim() || isNaN(body.stop_loss) || isNaN(body.target) || isNaN(body.quantity)) {
      setFormError('All fields are required')
      return
    }
    if (orderType === 'LIMIT' && (!limitPrice || isNaN(parseFloat(limitPrice)))) {
      setFormError('Limit price is required for LIMIT orders')
      return
    }
    setFormLoading(true)
    try {
      await placeTrade(tokenRef.current, body)
      setSymbol(''); setSymbolFull(''); setStopLoss(''); setTarget(''); setQuantity(''); setLimitPrice('')
      await fetchTrades()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to place trade')
    } finally {
      setFormLoading(false)
    }
  }

  async function handleClose(tradeId: string, exitPrice?: number) {
    setClosing(tradeId)
    try {
      const updated = await closeTrade(tokenRef.current, tradeId, exitPrice)
      setTrades(prev => prev.map(t => t.id === tradeId ? updated : t))
      setManualCloseId(null)
      setManualClosePrice('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to close trade')
    } finally {
      setClosing(null)
    }
  }

  function handleManualClose(tradeId: string) {
    const price = Number(manualClosePrice)
    if (!manualClosePrice || !(price > 0)) {
      alert('Enter a valid close price')
      return
    }
    handleClose(tradeId, price)
  }

  async function openJournal(tradeId: string) {
    if (journalOpen === tradeId) { setJournalOpen(null); return }
    setJournalOpen(tradeId)
    if (journalLoaded.has(tradeId)) return
    const entry = await getJournalEntry(tokenRef.current, tradeId).catch((): JournalEntry | null => null)
    setJournalLoaded(prev => new Set([...prev, tradeId]))
    setJournalDrafts(prev => ({
      ...prev,
      [tradeId]: {
        notes: entry?.notes ?? '',
        rating: entry?.rating ?? 3,
        tags: (entry?.tags ?? []).join(', '),
      },
    }))
  }

  async function saveJournal(tradeId: string) {
    const draft = journalDrafts[tradeId]
    if (!draft) return
    setJournalSaving(tradeId)
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean)
    try {
      await saveJournalEntry(tokenRef.current, tradeId, draft.notes, draft.rating, tags)
    } catch { /* MongoDB may be unavailable in dev */ } finally {
      setJournalSaving(null)
    }
  }

  function patchDraft(tradeId: string, patch: Partial<JournalDraft>) {
    setJournalDrafts(prev => ({
      ...prev,
      [tradeId]: { ...{ notes: '', rating: 3, tags: '' }, ...prev[tradeId], ...patch },
    }))
  }

  async function toggleAutoTrade() {
    if (!sotdSettings || autoTradeToggling) return
    setAutoTradeToggling(true)
    const next = { ...sotdSettings, auto_trade_enabled: !sotdSettings.auto_trade_enabled }
    try {
      const saved = await updateSotDSettings(tokenRef.current, next)
      setSotdSettings(saved)
    } catch { /* leave unchanged on error */ } finally {
      setAutoTradeToggling(false)
    }
  }

  const openTrades = trades.filter(t => t.status === 'open')
  const closedTrades = trades.filter(t => t.status === 'closed')
  const shown = tab === 'open' ? openTrades : closedTrades

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Paper Trading" />

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">

        {/* Auto-trading toggle */}
        {sotdSettings !== null && (
          <div className={`flex items-center justify-between rounded-xl border px-5 py-4 transition-colors ${
            sotdSettings.auto_trade_enabled
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
              : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
          }`}>
            <div className="flex items-center gap-3">
              {sotdSettings.auto_trade_enabled && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
              )}
              <div>
                <p className={`text-sm font-semibold ${
                  sotdSettings.auto_trade_enabled
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-zinc-700 dark:text-zinc-300'
                }`}>
                  Auto Trading — {sotdSettings.auto_trade_enabled ? 'ON' : 'OFF'}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {sotdSettings.auto_trade_enabled
                    ? `Stock of the Day trades placed automatically (confidence ≥ ${sotdSettings.threshold}%)`
                    : 'Automatic placement of Stock of the Day trades is disabled'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleAutoTrade}
              disabled={autoTradeToggling}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                sotdSettings.auto_trade_enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
              role="switch"
              aria-checked={sotdSettings.auto_trade_enabled}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                sotdSettings.auto_trade_enabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
        )}

        {/* Place trade form — hidden for viewers */}
        {user?.role === 'viewer' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Your account has <strong>viewer</strong> access — placing and closing trades requires a Trader or Admin role. Contact your administrator to upgrade your role.
          </div>
        ) : (
        <section>
          <h1 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Place Trade</h1>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <form onSubmit={handlePlace} className="flex flex-wrap items-end gap-3">
              {/* Signal */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Signal</span>
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                  {(['BUY', 'SELL'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setSignal(s)}
                      className={`px-4 py-2 text-sm font-semibold transition-colors ${
                        signal === s
                          ? s === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                          : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                      }`}>{s}</button>
                  ))}
                </div>
              </div>

              {/* Symbol search */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Symbol</label>
                <SymbolSearch
                  key={symbol}
                  value={symbol}
                  tokenRef={tokenRef}
                  disabled={formLoading}
                  onChange={(sym) => {
                    setSymbolFull(sym)
                    setSymbol(sym.replace(/\.(NS|BO)$/, ''))
                    setLtp(null)
                    getQuote(tokenRef.current, sym)
                      .then(q => setLtp(q.price))
                      .catch(() => {})
                  }}
                />
                {ltp !== null && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    LTP: <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{ltp.toFixed(2)}</span>
                  </p>
                )}
              </div>

              {/* Order type */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Order Type</span>
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                  {(['MARKET', 'LIMIT'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setOrderType(t)}
                      className={`px-3 py-2 text-xs font-semibold transition-colors ${
                        orderType === t
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                      }`}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Limit price — only for LIMIT orders */}
              {orderType === 'LIMIT' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Limit Price (₹)</label>
                  <input type="number" step="0.01" min="0" value={limitPrice}
                    onChange={e => setLimitPrice(e.target.value)} placeholder="1000.00"
                    disabled={formLoading} className={`w-28 ${INPUT}`} />
                </div>
              )}

              {/* Stop loss */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Stop Loss (₹)</label>
                <input type="number" step="0.01" min="0" value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)} placeholder="950.00"
                  disabled={formLoading} className={`w-28 ${INPUT}`} />
              </div>

              {/* Target */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Target (₹)</label>
                <input type="number" step="0.01" min="0" value={target}
                  onChange={e => setTarget(e.target.value)} placeholder="1100.00"
                  disabled={formLoading} className={`w-28 ${INPUT}`} />
              </div>

              {/* Quantity */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Quantity</label>
                <input type="number" step="1" min="1" value={quantity}
                  onChange={e => setQuantity(e.target.value)} placeholder="10"
                  disabled={formLoading} className={`w-24 ${INPUT}`} />
              </div>

              <button type="submit" disabled={formLoading}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                {formLoading ? 'Placing…' : 'Place Trade'}
              </button>
            </form>
            {formError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>}
          </div>
        </section>
        )}

        {/* Trade list */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(['open', 'closed'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === t
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {t === 'open' ? `Open (${openTrades.length})` : `Closed (${closedTrades.length})`}
                </button>
              ))}
            </div>
            {tab === 'open' && openTrades.length > 0 && (
              <div className="flex items-center gap-2">
                {pricesUpdatedAt && (
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Prices updated {Math.round((Date.now() - pricesUpdatedAt.getTime()) / 1000)}s ago · Yahoo Finance (~2–5 min delay)
                  </span>
                )}
                <button
                  onClick={() => fetchPrices(openTrades, true)}
                  disabled={pricesRefreshing}
                  className="rounded-md bg-white border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  {pricesRefreshing ? '↻ …' : '↻ Refresh'}
                </button>
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {tab === 'open' ? 'No open trades. Place a trade above.' : 'No closed trades yet.'}
              </p>
            </div>
          ) : tab === 'open' ? (
            <div className="space-y-3">
              {/* Summary strip */}
              {(() => {
                const totalPnl = openTrades.reduce((sum, t) => {
                  const cur = prices[t.symbol]
                  return cur !== undefined ? sum + livePnl(t, cur) : sum
                }, 0)
                const totalValue = openTrades.reduce((sum, t) => sum + t.entry_price * t.quantity, 0)
                const pnlPct = totalValue > 0 ? (totalPnl / totalValue) * 100 : 0
                const winners = openTrades.filter(t => {
                  const cur = prices[t.symbol]; return cur !== undefined && livePnl(t, cur) > 0
                }).length
                const up = totalPnl >= 0
                return (
                  <div className="flex flex-wrap gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <div>
                      <p className="text-[11px] text-zinc-400">Total Unrealized P&L</p>
                      <p className={`text-lg font-bold font-mono ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {up ? '+' : ''}₹{totalPnl.toFixed(2)}&nbsp;
                        <span className="text-sm font-semibold">({up ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                      </p>
                    </div>
                    <div className="w-px self-stretch bg-zinc-100 dark:bg-zinc-800" />
                    <div>
                      <p className="text-[11px] text-zinc-400">Position Value</p>
                      <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50 font-mono">₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className="w-px self-stretch bg-zinc-100 dark:bg-zinc-800" />
                    <div>
                      <p className="text-[11px] text-zinc-400">Positions</p>
                      <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{openTrades.length} open &nbsp;<span className="text-sm font-medium text-emerald-600">{winners}W</span> / <span className="text-sm font-medium text-red-500">{openTrades.length - winners}L</span></p>
                    </div>
                  </div>
                )
              })()}

              {/* Position cards */}
              {shown.map(trade => {
                const current = prices[trade.symbol]
                const pnl = current !== undefined ? livePnl(trade, current) : null
                const pnlPct = (pnl !== null && trade.entry_price > 0)
                  ? (trade.signal === 'BUY'
                      ? (current! - trade.entry_price) / trade.entry_price * 100
                      : (trade.entry_price - current!) / trade.entry_price * 100)
                  : null
                const up = pnl !== null ? pnl >= 0 : null

                // Price progress bar: position of current (and entry) between SL and target
                const barRange = trade.target - trade.stop_loss
                const barPct = (current !== undefined)
                  ? Math.min(100, Math.max(0, (current - trade.stop_loss) / barRange * 100))
                  : null
                const entryPct = Math.min(100, Math.max(0,
                  (trade.entry_price - trade.stop_loss) / barRange * 100
                ))

                // Holding duration
                const holdingStr = trade.opened_at ? (() => {
                  const ms = Date.now() - parseUTC(trade.opened_at).getTime()
                  const mins = Math.floor(ms / 60000)
                  if (mins < 60) return `${mins}m`
                  const hrs = Math.floor(mins / 60)
                  if (hrs < 24) return `${hrs}h ${mins % 60}m`
                  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
                })() : null

                const slDist = current !== undefined
                  ? Math.abs(current - trade.stop_loss) / current * 100 : null
                const tgtDist = current !== undefined
                  ? Math.abs(trade.target - current) / current * 100 : null

                return (
                  <div key={trade.id} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{trade.symbol.replace('.NS','').replace('.BO','')}</span>
                            <span className="text-xs text-zinc-400">{trade.exchange}</span>
                            <SignalBadge signal={trade.signal} />
                            <TradeTypeBadge mode={trade.mode} aiExplanation={trade.ai_explanation} />
                          </div>
                          {trade.opened_at && (
                            <p className="mt-0.5 text-[11px] text-zinc-400">
                              Opened {parseUTC(trade.opened_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', timeZone:'Asia/Kolkata' })} {parseUTC(trade.opened_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' })} IST
                              {holdingStr && <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{holdingStr} ago</span>}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Live P&L */}
                      <div className="text-right">
                        {pnl !== null ? (
                          <>
                            <p className={`text-xl font-bold font-mono ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                              {up ? '+' : ''}₹{pnl.toFixed(2)}
                            </p>
                            {pnlPct !== null && (
                              <p className={`text-sm font-semibold font-mono ${up ? 'text-emerald-500' : 'text-red-400'}`}>
                                {up ? '+' : ''}{pnlPct.toFixed(2)}%
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-lg font-bold text-zinc-400">—</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-zinc-400">Live P&L</p>
                      </div>
                    </div>

                    {/* Price progress bar */}
                    {barPct !== null && (
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-[10px] text-zinc-400">
                          <span>SL ₹{trade.stop_loss.toFixed(2)}</span>
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">
                            CMP ₹{current!.toFixed(2)}
                          </span>
                          <span>Target ₹{trade.target.toFixed(2)}</span>
                        </div>
                        <div className="relative h-2 w-full overflow-visible rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-500"
                            style={{ width: `${barPct ?? 0}%` }} />
                          {/* Buy price marker */}
                          <div
                            className="group absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${entryPct}%` }}
                            title={`Buy ₹${trade.entry_price.toFixed(2)}`}
                          >
                            <div className="h-3 w-3 rounded-full border-2 border-white bg-indigo-600 shadow dark:border-zinc-900" />
                            <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700">
                              Buy ₹{trade.entry_price.toFixed(2)}
                            </span>
                          </div>
                          {/* Current price marker (the ball moving from buy toward target) */}
                          {barPct !== null && (
                            <div
                              className="group absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
                              style={{ left: `${barPct}%` }}
                              title={`CMP ₹${current!.toFixed(2)}`}
                            >
                              <div className={`h-3.5 w-3.5 rounded-full border-2 border-white shadow-md dark:border-zinc-900 ${up ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700">
                                CMP ₹{current!.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="mt-1.5 flex justify-between text-[10px]">
                          <span className="text-red-400">Risk {slDist !== null ? `-${slDist.toFixed(1)}%` : ''}</span>
                          <span className="text-emerald-500">Reward {tgtDist !== null ? `+${tgtDist.toFixed(1)}%` : ''}</span>
                        </div>
                      </div>
                    )}

                    {/* Detail grid */}
                    <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800 sm:grid-cols-6">
                      {(() => {
                        const slPct = ((trade.stop_loss - trade.entry_price) / trade.entry_price * 100)
                        const tgtPct = ((trade.target - trade.entry_price) / trade.entry_price * 100)
                        return [
                          { label: 'Entry', value: `₹${trade.entry_price.toFixed(2)}` },
                          { label: 'Current', value: current !== undefined ? `₹${current.toFixed(2)}` : '—', highlight: up },
                          { label: 'Stop Loss', value: `₹${trade.stop_loss.toFixed(2)}`, sub: `${slPct.toFixed(1)}%`, red: true },
                          { label: 'Target', value: `₹${trade.target.toFixed(2)}`, sub: `+${tgtPct.toFixed(1)}%`, green: true },
                          { label: 'Qty', value: trade.quantity },
                          { label: 'R:R', value: trade.risk_reward_ratio.toFixed(2) },
                        ]
                      })().map(({ label, value, sub, highlight, red, green }) => (
                        <div key={label}>
                          <p className="text-zinc-400">{label}</p>
                          <p className={`font-semibold font-mono ${
                            red ? 'text-red-500 dark:text-red-400' :
                            green ? 'text-emerald-600 dark:text-emerald-400' :
                            highlight === true ? 'text-emerald-600 dark:text-emerald-400' :
                            highlight === false ? 'text-red-500 dark:text-red-400' :
                            'text-zinc-800 dark:text-zinc-200'
                          }`}>{value}</p>
                          {sub && (
                            <p className={`text-[10px] font-mono ${red ? 'text-red-400' : 'text-emerald-500'}`}>{sub}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* AI explanation */}
                    {trade.ai_explanation && (
                      <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                        {trade.ai_explanation}
                      </p>
                    )}

                    {/* Actions row */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AddToWatchlistBtn symbol={trade.symbol} token={tokenRef.current} watchlists={watchlists} />
                        <button
                          onClick={() => toggleChart(trade.id, trade.symbol)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                            chartTradeId === trade.id
                              ? 'bg-indigo-600 text-white'
                              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                          }`}
                        >
                          📈 {chartTradeId === trade.id ? 'Hide Chart' : 'Chart'}
                        </button>
                      </div>
                      {user?.role !== 'viewer' && (
                        <div className="flex flex-col items-end gap-1.5">
                          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            <input
                              type="checkbox"
                              checked={manualCloseId === trade.id}
                              onChange={e => {
                                setManualCloseId(e.target.checked ? trade.id : null)
                                setManualClosePrice('')
                              }}
                              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            Enter close price manually
                          </label>
                          {manualCloseId === trade.id && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-500">₹</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                autoFocus
                                value={manualClosePrice}
                                onChange={e => setManualClosePrice(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleManualClose(trade.id) }}
                                placeholder="Exit price"
                                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                              />
                            </div>
                          )}
                          <button
                            onClick={() => {
                              if (manualCloseId === trade.id) {
                                handleManualClose(trade.id)
                              } else {
                                handleClose(trade.id)
                              }
                            }}
                            disabled={closing === trade.id}
                            className="rounded-lg bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                          >
                            {closing === trade.id ? 'Closing…' : 'Close Position'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Inline chart: LTP, buy price, SL and target overlaid on candles */}
                    {chartTradeId === trade.id && (
                      <div className="mt-4">
                        <PriceChart
                          symbol={trade.symbol}
                          data={chartBars}
                          period={chartPeriod}
                          onPeriodChange={setChartPeriod}
                          loading={chartLoading}
                          currentPrice={current ?? null}
                          aiLevels={{
                            signal: trade.signal,
                            entry: trade.entry_price,
                            stopLoss: trade.stop_loss,
                            target: trade.target,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            // Closed trades with inline journal panel
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className={TH}>Symbol</th>
                    <th className={TH}>Signal</th>
                    <th className={TH}>Type</th>
                    <th className={TH_R}>Entry</th>
                    <th className={TH_R}>Exit</th>
                    <th className={TH_R}>Qty</th>
                    <th className={TH_R}>P&amp;L</th>
                    <th className={TH_R}>R:R</th>
                    <th className={TH_R}>Closed</th>
                    <th className={TH} />
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {shown.map(trade => {
                    const draft = journalDrafts[trade.id] ?? { notes: '', rating: 3, tags: '' }
                    const isJournalOpen = journalOpen === trade.id
                    return (
                      <Fragment key={trade.id}>
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className={TD}>
                            <span className="font-medium text-zinc-900 dark:text-zinc-50">{trade.symbol}</span>
                            <span className="ml-1.5 text-xs text-zinc-400">{trade.exchange}</span>
                            {trade.opened_at && (() => {
                              const d = parseUTC(trade.opened_at)
                              return (
                                <div className="mt-0.5 text-[10px] text-zinc-400">
                                  Opened: {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })} {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
                                </div>
                              )
                            })()}
                          </td>
                          <td className={TD}><SignalBadge signal={trade.signal} /></td>
                          <td className={TD}><TradeTypeBadge mode={trade.mode} aiExplanation={trade.ai_explanation} /></td>
                          <td className={TD_R}>₹{trade.entry_price.toFixed(2)}</td>
                          <td className={TD_R}>
                            {trade.exit_price !== null ? `₹${trade.exit_price.toFixed(2)}` : '—'}
                          </td>
                          <td className={TD_R}>{trade.quantity}</td>
                          <td className="px-3 py-3 text-right">
                            {trade.pnl !== null ? <PnlCell value={trade.pnl} pct={calcPnlPct(trade)} /> : <span className="text-zinc-400">—</span>}
                          </td>
                          <td className={TD_R}>{trade.risk_reward_ratio.toFixed(2)}</td>
                          <td className={TD_R}>
                            {trade.closed_at ? (() => {
                              const d = parseUTC(trade.closed_at)
                              return (
                                <>
                                  <div className="text-xs text-zinc-700 dark:text-zinc-300">{d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</div>
                                  <div className="text-[10px] text-zinc-400">{d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</div>
                                </>
                              )
                            })() : '—'}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              onClick={() => openJournal(trade.id)}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                isJournalOpen
                                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
                              }`}
                            >
                              Journal
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <AddToWatchlistBtn symbol={trade.symbol} token={tokenRef.current} watchlists={watchlists} />
                          </td>
                        </tr>

                        {isJournalOpen && (
                          <tr>
                            <td colSpan={10} className="p-0">
                              <div className="border-t border-indigo-100 bg-indigo-50/40 px-4 py-4 dark:border-indigo-900/30 dark:bg-indigo-950/10">
                                <div className="flex flex-wrap items-start gap-6">
                                  {/* Notes textarea */}
                                  <div className="flex-1 min-w-[200px]">
                                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">Notes</label>
                                    <textarea
                                      value={draft.notes}
                                      onChange={e => patchDraft(trade.id, { notes: e.target.value })}
                                      rows={3}
                                      placeholder="What did you learn from this trade?"
                                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                                    />
                                  </div>

                                  {/* Rating, Tags, Save */}
                                  <div className="flex flex-col gap-3">
                                    <div>
                                      <p className="mb-1.5 text-xs font-medium text-zinc-500">Rating</p>
                                      <div className="flex gap-0.5">
                                        {[1, 2, 3, 4, 5].map(n => (
                                          <button
                                            key={n}
                                            type="button"
                                            onClick={() => patchDraft(trade.id, { rating: n })}
                                            className={`text-xl leading-none transition-colors ${
                                              draft.rating >= n
                                                ? 'text-amber-500 dark:text-amber-400'
                                                : 'text-zinc-300 dark:text-zinc-600'
                                            }`}
                                          >
                                            ★
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <div>
                                      <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                                        Tags <span className="font-normal text-zinc-400">(comma-separated)</span>
                                      </label>
                                      <input
                                        value={draft.tags}
                                        onChange={e => patchDraft(trade.id, { tags: e.target.value })}
                                        placeholder="FOMO, breakout, held too long"
                                        className="w-52 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                                      />
                                    </div>

                                    <button
                                      onClick={() => saveJournal(trade.id)}
                                      disabled={journalSaving === trade.id}
                                      className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                                    >
                                      {journalSaving === trade.id ? 'Saving…' : 'Save Journal'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

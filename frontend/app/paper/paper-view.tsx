'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  closeTrade, getJournalEntry, getMe, getQuote,
  listTrades, placeTrade, saveJournalEntry, searchStocks,
} from '@/lib/api'
import type { JournalEntry, PlaceTradeBody, StockSearchResult, Trade, User } from '@/lib/api'

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

function livePnl(trade: Trade, currentPrice: number): number {
  return trade.signal === 'BUY'
    ? (currentPrice - trade.entry_price) * trade.quantity
    : (trade.entry_price - currentPrice) * trade.quantity
}

function PnlCell({ value }: { value: number }) {
  const up = value >= 0
  return (
    <span className={`font-mono ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {up ? '+' : ''}₹{value.toFixed(2)}
    </span>
  )
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
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [closing, setClosing] = useState<string | null>(null)

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

  const fetchPrices = useCallback(async (openTrades: Trade[]) => {
    if (openTrades.length === 0) return
    const symbols = [...new Set(openTrades.map(t => t.symbol))]
    const results = await Promise.allSettled(symbols.map(s => getQuote(tokenRef.current, s)))
    setPrices(prev => {
      const next = { ...prev }
      results.forEach((r, i) => { if (r.status === 'fulfilled') next[symbols[i]] = r.value.price })
      return next
    })
  }, [])

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
    listTrades(t)
      .then(async (all) => {
        setTrades(all)
        await fetchPrices(all.filter(tr => tr.status === 'open'))
      })
      .catch(() => { localStorage.removeItem('mts_token'); router.replace('/login') })
      .finally(() => setLoading(false))
  }, [router, fetchPrices])

  useEffect(() => {
    const open = trades.filter(t => t.status === 'open')
    if (open.length === 0) return
    const id = setInterval(() => fetchPrices(open), 30_000)
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

  async function handleClose(tradeId: string) {
    setClosing(tradeId)
    try {
      const updated = await closeTrade(tokenRef.current, tradeId)
      setTrades(prev => prev.map(t => t.id === tradeId ? updated : t))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to close trade')
    } finally {
      setClosing(null)
    }
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
      [tradeId]: { notes: '', rating: 3, tags: '', ...prev[tradeId], ...patch },
    }))
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
          <div className="mb-4 flex items-center gap-1">
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

          {shown.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {tab === 'open' ? 'No open trades. Place a trade above.' : 'No closed trades yet.'}
              </p>
            </div>
          ) : tab === 'open' ? (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className={TH}>Symbol</th>
                    <th className={TH}>Signal</th>
                    <th className={TH_R}>Entry</th>
                    <th className={TH_R}>Current</th>
                    <th className={TH_R}>Stop Loss</th>
                    <th className={TH_R}>Target</th>
                    <th className={TH_R}>Qty</th>
                    <th className={TH_R}>Live P&amp;L</th>
                    <th className={TH_R}>R:R</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {shown.map(trade => {
                    const current = prices[trade.symbol]
                    const pnl = current !== undefined ? livePnl(trade, current) : null
                    return (
                      <tr key={trade.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <td className={TD}>
                          <span className="font-medium text-zinc-900 dark:text-zinc-50">{trade.symbol}</span>
                          <span className="ml-1.5 text-xs text-zinc-400">{trade.exchange}</span>
                        </td>
                        <td className={TD}><SignalBadge signal={trade.signal} /></td>
                        <td className={TD_R}>₹{trade.entry_price.toFixed(2)}</td>
                        <td className={TD_R}>{current !== undefined ? `₹${current.toFixed(2)}` : '—'}</td>
                        <td className={TD_R}>₹{trade.stop_loss.toFixed(2)}</td>
                        <td className={TD_R}>₹{trade.target.toFixed(2)}</td>
                        <td className={TD_R}>{trade.quantity}</td>
                        <td className="px-3 py-3 text-right">
                          {pnl !== null ? <PnlCell value={pnl} /> : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className={TD_R}>{trade.risk_reward_ratio.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right">
                          {user?.role !== 'viewer' && (
                            <button
                              onClick={() => handleClose(trade.id)}
                              disabled={closing === trade.id}
                              className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                            >
                              {closing === trade.id ? '…' : 'Close'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            // Closed trades with inline journal panel
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className={TH}>Symbol</th>
                    <th className={TH}>Signal</th>
                    <th className={TH_R}>Entry</th>
                    <th className={TH_R}>Exit</th>
                    <th className={TH_R}>Qty</th>
                    <th className={TH_R}>P&amp;L</th>
                    <th className={TH_R}>R:R</th>
                    <th className={TH_R}>Closed</th>
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
                          </td>
                          <td className={TD}><SignalBadge signal={trade.signal} /></td>
                          <td className={TD_R}>₹{trade.entry_price.toFixed(2)}</td>
                          <td className={TD_R}>
                            {trade.exit_price !== null ? `₹${trade.exit_price.toFixed(2)}` : '—'}
                          </td>
                          <td className={TD_R}>{trade.quantity}</td>
                          <td className="px-3 py-3 text-right">
                            {trade.pnl !== null ? <PnlCell value={trade.pnl} /> : <span className="text-zinc-400">—</span>}
                          </td>
                          <td className={TD_R}>{trade.risk_reward_ratio.toFixed(2)}</td>
                          <td className={TD_R}>
                            {trade.closed_at
                              ? new Date(trade.closed_at).toLocaleString('en-IN', {
                                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                                  timeZone: 'Asia/Kolkata',
                                })
                              : '—'}
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
                        </tr>

                        {isJournalOpen && (
                          <tr>
                            <td colSpan={9} className="p-0">
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

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getNgQuote, listNgTrades, placeNgTrade, closeNgTrade, getBrokerStatus,
} from '@/lib/api'
import type { NgQuote, McxTrade, BrokerStatus } from '@/lib/api'

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }
function pnlColor(v: number) { return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-500' }

type Tab = 'dashboard' | 'trade' | 'portfolio'

// ── NG Dashboard ─────────────────────────────────────────────────────────────

function NgDashboard({ quote, loading, error }: { quote: NgQuote | null; loading: boolean; error: string | null }) {
  if (loading && !quote) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    )
  }
  if (error || !quote) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center dark:border-amber-900 dark:bg-amber-950/30">
        <p className="text-sm text-amber-800 dark:text-amber-300">{error ?? 'No MCX quote available.'}</p>
      </div>
    )
  }

  const stat = (label: string, value: string, accent = '') => (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={cls('mt-1 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-50', accent)}>{value}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-cyan-50 to-white p-6 dark:border-zinc-800 dark:from-cyan-950/20 dark:to-zinc-900">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
              MCX Natural Gas &middot; {quote.tradingsymbol}
            </p>
            <p className="mt-1 text-4xl font-bold font-mono text-zinc-900 dark:text-zinc-50">₹{quote.last_price.toFixed(2)}</p>
            <p className={cls('mt-1 text-sm font-mono font-semibold', pnlColor(quote.change))}>
              {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.change >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
            </p>
          </div>
          <div className="text-right text-xs text-zinc-400">
            <p>Expiry {quote.expiry}</p>
            <p>Lot size {quote.lot_size} mmBtu</p>
            <p>Tick {quote.tick_size}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Open', `₹${quote.open.toFixed(2)}`)}
        {stat('High', `₹${quote.high.toFixed(2)}`, 'text-emerald-600 dark:text-emerald-400')}
        {stat('Low', `₹${quote.low.toFixed(2)}`, 'text-red-500 dark:text-red-400')}
        {stat('Prev Close', `₹${quote.prev_close.toFixed(2)}`)}
        {stat('Volume', quote.volume.toLocaleString('en-IN'))}
        {stat('Open Interest', quote.oi.toLocaleString('en-IN'))}
        {stat('OI Day High', quote.oi_day_high.toLocaleString('en-IN'))}
        {stat('OI Day Low', quote.oi_day_low.toLocaleString('en-IN'))}
      </div>

      <p className="text-xs text-zinc-400">
        Live price via your connected Zerodha Kite account for the current front-month MCX Natural Gas futures
        contract. Refreshes every 15s.
      </p>
    </div>
  )
}

// ── Trade ─────────────────────────────────────────────────────────────────────

function NgTradeForm({ quote, onPlaced }: { quote: NgQuote | null; onPlaced: () => void }) {
  const [signal, setSignal] = useState<'BUY' | 'SELL'>('BUY')
  const [lots, setLots] = useState('1')
  const [stopLoss, setStopLoss] = useState('')
  const [target, setTarget] = useState('')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setSubmitting(true)
    try {
      const trade = await placeNgTrade(t, {
        signal,
        lots: parseInt(lots, 10),
        stop_loss: parseFloat(stopLoss),
        target: parseFloat(target),
        limit_price: orderType === 'LIMIT' ? parseFloat(limitPrice) : undefined,
      })
      setSuccess(`${signal} ${lots} lot(s) placed at ₹${trade.entry_price.toFixed(2)}`)
      setStopLoss(''); setTarget(''); setLimitPrice('')
      onPlaced()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place trade')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

  return (
    <div className="max-w-xl">
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {quote && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {quote.tradingsymbol} &middot; LTP ₹{quote.last_price.toFixed(2)} &middot; Lot size {quote.lot_size} mmBtu
          </div>
        )}

        <div className="flex gap-2">
          {(['BUY', 'SELL'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSignal(s)}
              className={cls(
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
                signal === s
                  ? (s === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white')
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Lots</label>
          <input type="number" min={1} value={lots} onChange={e => setLots(e.target.value)} className={inputCls} required />
        </div>

        <div className="flex gap-2">
          {(['MARKET', 'LIMIT'] as const).map(t => (
            <button key={t} type="button" onClick={() => setOrderType(t)}
              className={cls(
                'flex-1 rounded-lg py-1.5 text-xs font-semibold',
                orderType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {orderType === 'LIMIT' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Limit Price</label>
            <input type="number" step="0.1" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} className={inputCls} required />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Stop Loss</label>
            <input type="number" step="0.1" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Target</label>
            <input type="number" step="0.1" value={target} onChange={e => setTarget(e.target.value)} className={inputCls} required />
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">{success}</p>}

        <button type="submit" disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? 'Placing…' : `Place ${signal} Order (Paper)`}
        </button>
        <p className="text-center text-[11px] text-zinc-400">
          Paper trade only — simulated against the real live MCX price, no real order is sent.
        </p>
      </form>
    </div>
  )
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

function TradeRow({ t, showClose, onClose, closing }: {
  t: McxTrade; showClose: boolean; onClose?: (id: string) => void; closing?: boolean
}) {
  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{t.symbol}</td>
      <td className="px-3 py-2.5">
        <span className={cls('rounded px-2 py-0.5 text-[10px] font-bold text-white', t.signal === 'BUY' ? 'bg-emerald-600' : 'bg-red-500')}>
          {t.signal}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono">{t.lots}</td>
      <td className="px-3 py-2.5 font-mono">₹{t.entry_price.toFixed(2)}</td>
      {showClose ? (
        <>
          <td className="px-3 py-2.5 font-mono text-red-500">₹{t.stop_loss.toFixed(2)}</td>
          <td className="px-3 py-2.5 font-mono text-emerald-600">₹{t.target.toFixed(2)}</td>
          <td className="px-3 py-2.5 capitalize text-zinc-500">{t.status}</td>
          <td className="px-3 py-2.5">
            {t.status === 'open' && onClose && (
              <button onClick={() => onClose(t.id)} disabled={closing}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {closing ? 'Closing…' : 'Close'}
              </button>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-2.5 font-mono">{t.exit_price != null ? `₹${t.exit_price.toFixed(2)}` : '—'}</td>
          <td className={cls('px-3 py-2.5 font-mono font-semibold', pnlColor(t.pnl ?? 0))}>
            {t.pnl != null ? `₹${t.pnl.toFixed(2)}` : '—'}
          </td>
          <td className="px-3 py-2.5 capitalize text-zinc-500">{t.status}</td>
        </>
      )}
    </tr>
  )
}

function NgPortfolio({ trades, loading, onClose, closingId }: {
  trades: McxTrade[]; loading: boolean; onClose: (id: string) => void; closingId: string | null
}) {
  const open = trades.filter(t => t.status === 'open' || t.status === 'pending')
  const closed = trades.filter(t => t.status === 'closed' || t.status === 'cancelled')
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)

  if (loading) return <div className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No MCX Natural Gas trades yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Open Positions</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{open.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Closed Trades</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{closed.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Realized P&amp;L</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(totalPnl))}>₹{totalPnl.toFixed(2)}</p>
        </div>
      </div>

      {open.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Open</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Contract', 'Signal', 'Lots', 'Entry', 'SL', 'Target', 'Status', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {open.map(t => (
                  <TradeRow key={t.id} t={t} showClose onClose={onClose} closing={closingId === t.id} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Closed</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Contract', 'Signal', 'Lots', 'Entry', 'Exit', 'P&L', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {closed.map(t => <TradeRow key={t.id} t={t} showClose={false} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'NG Dashboard' },
  { id: 'trade', label: 'Trade' },
  { id: 'portfolio', label: 'Portfolio' },
]

export default function McxView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [broker, setBroker] = useState<BrokerStatus | null>(null)
  const [quote, setQuote] = useState<NgQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [trades, setTrades] = useState<McxTrade[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)
  const [closingId, setClosingId] = useState<string | null>(null)

  const loadQuote = useCallback(() => {
    const t = tokenRef.current
    if (!t) return
    getNgQuote(t)
      .then(q => { setQuote(q); setQuoteError(null); setQuoteLoading(false) })
      .catch(err => { setQuoteError(err instanceof Error ? err.message : 'Failed to load MCX quote'); setQuoteLoading(false) })
  }, [])

  const loadTrades = useCallback(() => {
    const t = tokenRef.current
    if (!t) return
    setTradesLoading(true)
    listNgTrades(t).then(ts => { setTrades(ts); setTradesLoading(false) }).catch(() => setTradesLoading(false))
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getBrokerStatus(t).then(setBroker).catch(() => null)
    loadQuote()
    loadTrades()
    const id = setInterval(loadQuote, 15_000)
    return () => clearInterval(id)
  }, [router, loadQuote, loadTrades])

  async function handleClose(id: string) {
    setClosingId(id)
    try {
      await closeNgTrade(tokenRef.current, id)
      loadTrades()
    } catch {
      // surfaced via trade list staying unchanged; keep it simple
    } finally {
      setClosingId(null)
    }
  }

  const zerodhaConnected = broker?.broker === 'zerodha' && broker.connected

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">MCX Natural Gas</h1>
          <p className="text-xs text-zinc-400">
            Live front-month MCX Natural Gas futures dashboard, with paper trading against the real price.
          </p>
        </div>

        {!zerodhaConnected && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            MCX has no free public data feed — connect your Zerodha account to see live Natural Gas prices and trade.{' '}
            <a href="/broker" className="font-semibold underline">Go to Broker settings →</a>
          </div>
        )}

        <div className="mb-6 flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cls(
                'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && <NgDashboard quote={quote} loading={quoteLoading} error={quoteError} />}
        {tab === 'trade' && <NgTradeForm quote={quote} onPlaced={loadTrades} />}
        {tab === 'portfolio' && (
          <NgPortfolio trades={trades} loading={tradesLoading} onClose={handleClose} closingId={closingId} />
        )}
      </main>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { closeTrade, getMe, getQuote, listTrades, placeTrade } from '@/lib/api'
import type { PlaceTradeBody, Trade, User } from '@/lib/api'

type Tab = 'open' | 'closed'

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
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<User | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [closing, setClosing] = useState<string | null>(null)

  // Form state
  const [signal, setSignal] = useState<'BUY' | 'SELL'>('BUY')
  const [symbol, setSymbol] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [target, setTarget] = useState('')
  const [quantity, setQuantity] = useState('')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const fetchPrices = useCallback(async (openTrades: Trade[]) => {
    if (openTrades.length === 0) return
    const symbols = [...new Set(openTrades.map(t => t.symbol))]
    const results = await Promise.allSettled(
      symbols.map(s => getQuote(tokenRef.current, s)),
    )
    setPrices(prev => {
      const next = { ...prev }
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[symbols[i]] = r.value.price
      })
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

    Promise.all([getMe(t), listTrades(t)])
      .then(async ([me, all]) => {
        setUser(me)
        setTrades(all)
        await fetchPrices(all.filter(tr => tr.status === 'open'))
      })
      .catch(() => {
        localStorage.removeItem('mts_token')
        router.replace('/login')
      })
      .finally(() => setLoading(false))
  }, [router, fetchPrices])

  // Poll live prices for open trades every 30 s
  useEffect(() => {
    const open = trades.filter(t => t.status === 'open')
    if (open.length === 0) return
    const id = setInterval(() => fetchPrices(open), 30_000)
    return () => clearInterval(id)
  }, [trades, fetchPrices])

  async function handlePlace(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const body: PlaceTradeBody = {
      symbol: symbol.trim(),
      signal,
      stop_loss: parseFloat(stopLoss),
      target: parseFloat(target),
      quantity: parseInt(quantity, 10),
    }
    if (!body.symbol || isNaN(body.stop_loss) || isNaN(body.target) || isNaN(body.quantity)) {
      setFormError('All fields are required')
      return
    }
    setFormLoading(true)
    try {
      await placeTrade(tokenRef.current, body)
      setSymbol(''); setStopLoss(''); setTarget(''); setQuantity('')
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

  function handleSignOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
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
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Manju Trade AI Pro
            </span>
            <nav className="flex items-center gap-4 text-xs">
              <Link href="/dashboard" className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
                Watchlist
              </Link>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">Paper Trading</span>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{user?.full_name}</span>
            <button
              onClick={handleSignOut}
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">

        {/* Place trade form */}
        <section>
          <h1 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Place Trade
          </h1>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <form onSubmit={handlePlace} className="flex flex-wrap items-end gap-3">
              {/* Signal toggle */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">Signal</span>
                <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSignal('BUY')}
                    className={`px-4 py-2 text-sm font-semibold transition-colors ${
                      signal === 'BUY'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    BUY
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignal('SELL')}
                    className={`px-4 py-2 text-sm font-semibold transition-colors ${
                      signal === 'SELL'
                        ? 'bg-red-600 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    SELL
                  </button>
                </div>
              </div>

              {/* Symbol */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Symbol</label>
                <input
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  placeholder="RELIANCE"
                  disabled={formLoading}
                  className={`w-32 ${INPUT}`}
                />
              </div>

              {/* Stop Loss */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Stop Loss (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  placeholder="950.00"
                  disabled={formLoading}
                  className={`w-28 ${INPUT}`}
                />
              </div>

              {/* Target */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Target (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder="1100.00"
                  disabled={formLoading}
                  className={`w-28 ${INPUT}`}
                />
              </div>

              {/* Quantity */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Quantity</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="10"
                  disabled={formLoading}
                  className={`w-24 ${INPUT}`}
                />
              </div>

              <button
                type="submit"
                disabled={formLoading}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {formLoading ? 'Placing…' : 'Place Trade'}
              </button>
            </form>

            {formError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}
          </div>
        </section>

        {/* Trade list */}
        <section>
          {/* Tabs */}
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
                        <td className={TD_R}>
                          {current !== undefined ? `₹${current.toFixed(2)}` : '—'}
                        </td>
                        <td className={TD_R}>₹{trade.stop_loss.toFixed(2)}</td>
                        <td className={TD_R}>₹{trade.target.toFixed(2)}</td>
                        <td className={TD_R}>{trade.quantity}</td>
                        <td className="px-3 py-3 text-right">
                          {pnl !== null ? <PnlCell value={pnl} /> : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className={TD_R}>{trade.risk_reward_ratio.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => handleClose(trade.id)}
                            disabled={closing === trade.id}
                            className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                          >
                            {closing === trade.id ? '…' : 'Close'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {shown.map(trade => (
                    <tr key={trade.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
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
                          ? new Date(trade.closed_at).toLocaleDateString('en-IN', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

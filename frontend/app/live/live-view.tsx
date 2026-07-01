'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { cancelLiveOrder, getLivePositions, getQuote, listLiveOrders, placeLiveOrder, searchStocks } from '@/lib/api'
import type { LiveOrder, LivePosition, StockSearchResult } from '@/lib/api'

const INPUT = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'

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
      setResults(r); setOpen(r.length > 0)
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
      <input value={q} onChange={handleChange} onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search symbol…" disabled={disabled} className={INPUT} />
      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.slice(0, 8).map(r => (
            <button key={r.symbol} type="button" onMouseDown={() => pick(r)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {r.symbol.replace(/\.(NS|BO)$/, '')}
                </span>
                <span className="ml-2 text-xs text-zinc-400">{r.exchange}</span>
                <p className="max-w-[160px] truncate text-xs text-zinc-500 dark:text-zinc-400">{r.name}</p>
              </div>
              <span className="text-[10px] text-zinc-400">{r.sector}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

function LiveViewInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenRef = useRef('')
  const [orders, setOrders] = useState<LiveOrder[]>([])
  const [positions, setPositions] = useState<LivePosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [ltp, setLtp] = useState<number | null>(null)
  const [symbolFull, setSymbolFull] = useState(params.get('symbol') ?? '')

  const [form, setForm] = useState({
    symbol: params.get('symbol')?.replace(/\.(NS|BO)$/, '') ?? '',
    signal: (params.get('signal') as 'BUY' | 'SELL') ?? 'BUY',
    quantity: 1,
    order_type: 'MARKET' as 'MARKET' | 'LIMIT',
    price: '',
    stop_loss: '',
    target: '',
  })

  const refresh = useCallback(async (token: string) => {
    const [ords, pos] = await Promise.all([listLiveOrders(token), getLivePositions(token)])
    setOrders(ords); setPositions(pos)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    Promise.all([listLiveOrders(t), getLivePositions(t)])
      .then(([ords, pos]) => { setOrders(ords); setPositions(pos) })
      .catch(() => null)
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setSuccess(null)
    const sym = symbolFull || `${form.symbol.toUpperCase()}.NS`
    try {
      const order = await placeLiveOrder(tokenRef.current, {
        symbol: sym,
        signal: form.signal,
        quantity: form.quantity,
        order_type: form.order_type,
        price: form.price ? parseFloat(form.price) : undefined,
        stop_loss: form.stop_loss ? parseFloat(form.stop_loss) : undefined,
        target: form.target ? parseFloat(form.target) : undefined,
      })
      setSuccess(`Order placed: ${order.signal} ${order.quantity}× ${order.symbol} @ ₹${order.fill_price ?? '—'}`)
      await refresh(tokenRef.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally { setLoading(false) }
  }

  async function handleCancel(boid: string) {
    try {
      await cancelLiveOrder(tokenRef.current, boid)
      await refresh(tokenRef.current)
    } catch (e) { setError(e instanceof Error ? e.message : 'Cancel failed') }
  }

  const signalCls = (s: string) => s === 'BUY'
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'

  const statusCls = (s: string) =>
    s === 'filled'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : s === 'cancelled' || s === 'rejected'
        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Live Trading" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Live Trading</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Orders execute through your connected broker (Zerodha or Simulated). Configure broker on the Broker page.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Order form */}
          <div className="lg:col-span-1">
            <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Place Order</p>

              {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
              {success && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{success}</p>}

              <div className="flex flex-col gap-3">
                {/* Symbol */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Symbol</label>
                  <SymbolSearch
                    key={form.symbol}
                    value={form.symbol}
                    tokenRef={tokenRef}
                    disabled={loading}
                    onChange={(sym) => {
                      setSymbolFull(sym)
                      setForm(f => ({ ...f, symbol: sym.replace(/\.(NS|BO)$/, '') }))
                      setLtp(null)
                      getQuote(tokenRef.current, sym).then(q => setLtp(q.price)).catch(() => {})
                    }}
                  />
                  {ltp !== null && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      LTP: <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{ltp.toFixed(2)}</span>
                    </p>
                  )}
                </div>

                {/* Signal */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Signal</label>
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                    {(['BUY', 'SELL'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setForm(f => ({ ...f, signal: s }))}
                        className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                          form.signal === s
                            ? s === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                            : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>

                {/* Quantity */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Quantity</label>
                  <input required type="number" min={1} value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                    className={INPUT} />
                </div>

                {/* Order type */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Order Type</label>
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                    {(['MARKET', 'LIMIT'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setForm(f => ({ ...f, order_type: t }))}
                        className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                          form.order_type === t
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                        }`}>{t}</button>
                    ))}
                  </div>
                </div>

                {/* Limit price */}
                {form.order_type === 'LIMIT' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Limit Price (₹)</label>
                    <input type="number" step="0.01" value={form.price}
                      onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder={ltp ? ltp.toFixed(2) : '0.00'}
                      className={INPUT} />
                  </div>
                )}

                {/* Stop loss + target */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Stop Loss</label>
                    <input type="number" step="0.01" value={form.stop_loss}
                      onChange={e => setForm(f => ({ ...f, stop_loss: e.target.value }))}
                      className={INPUT} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Target</label>
                    <input type="number" step="0.01" value={form.target}
                      onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                      className={INPUT} />
                  </div>
                </div>

                <button type="submit" disabled={loading}
                  className="mt-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                  {loading ? 'Placing…' : 'Place Order'}
                </button>
              </div>
            </form>
          </div>

          {/* Positions + Orders */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {/* Positions */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Open Positions</p>
              {positions.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No positions yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Symbol', 'Signal', 'Qty', 'Avg Price'].map(h => (
                        <th key={h} className="pb-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="py-2 font-mono font-semibold text-zinc-900 dark:text-zinc-50">{p.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`py-2 font-bold ${signalCls(p.signal)}`}>{p.signal}</td>
                        <td className="py-2 text-zinc-600 dark:text-zinc-300">{p.quantity}</td>
                        <td className="py-2 font-mono text-zinc-700 dark:text-zinc-300">₹{p.avg_price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Order book */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Order Book</p>
              {orders.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No orders placed yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Symbol', 'Signal', 'Qty', 'Fill Price', 'Time', 'Status', ''].map(h => (
                        <th key={h} className="pb-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => {
                      const odDt = new Date(o.created_at)
                      return (
                      <tr key={o.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="py-2 font-mono font-semibold text-zinc-900 dark:text-zinc-50">{o.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`py-2 font-bold ${signalCls(o.signal)}`}>{o.signal}</td>
                        <td className="py-2 text-zinc-600 dark:text-zinc-300">{o.quantity}</td>
                        <td className="py-2 font-mono text-zinc-700 dark:text-zinc-300">
                          {o.fill_price ? `₹${o.fill_price.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2">
                          <div className="text-xs text-zinc-700 dark:text-zinc-300">{odDt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}</div>
                          <div className="text-[10px] text-zinc-400">{odDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</div>
                        </td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCls(o.status)}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {(o.status === 'open' || o.status === 'pending') && (
                            <button onClick={() => handleCancel(o.broker_order_id ?? o.id)}
                              className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function LiveView() {
  return (
    <Suspense>
      <LiveViewInner />
    </Suspense>
  )
}

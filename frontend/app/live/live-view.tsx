'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { placeLiveOrder, listLiveOrders, cancelLiveOrder, getLivePositions } from '@/lib/api'
import type { LiveOrder, LivePosition } from '@/lib/api'

function LiveViewInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenRef = useRef('')
  const [orders, setOrders] = useState<LiveOrder[]>([])
  const [positions, setPositions] = useState<LivePosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
    setOrders(ords)
    setPositions(pos)
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
    try {
      const order = await placeLiveOrder(tokenRef.current, {
        symbol: form.symbol.toUpperCase(),
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


  const signalColor = (s: string) => s === 'BUY'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-500 dark:text-red-400'

  const statusColor = (s: string) =>
    s === 'filled' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : s === 'cancelled' || s === 'rejected' ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Live Trading" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Live Trading</h1>
          <p className="text-xs text-zinc-400">
            Orders execute through your connected broker (Zerodha or Simulated). Configure broker on the Broker page.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Order form */}
          <div className="lg:col-span-1">
            <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Place Order</p>

              {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>}
              {success && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{success}</p>}

              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Symbol</label>
                  <input
                    required
                    value={form.symbol}
                    onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                    placeholder="RELIANCE"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Signal</label>
                  <select
                    value={form.signal}
                    onChange={e => setForm(f => ({ ...f, signal: e.target.value as 'BUY' | 'SELL' }))}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option>BUY</option>
                    <option>SELL</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Quantity</label>
                  <input
                    required type="number" min={1}
                    value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Order Type</label>
                  <select
                    value={form.order_type}
                    onChange={e => setForm(f => ({ ...f, order_type: e.target.value as 'MARKET' | 'LIMIT' }))}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option>MARKET</option>
                    <option>LIMIT</option>
                  </select>
                </div>

                {form.order_type === 'LIMIT' && (
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Limit Price (₹)</label>
                    <input
                      type="number" step="0.01"
                      value={form.price}
                      onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Stop Loss</label>
                    <input type="number" step="0.01" value={form.stop_loss}
                      onChange={e => setForm(f => ({ ...f, stop_loss: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Target</label>
                    <input type="number" step="0.01" value={form.target}
                      onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
                  </div>
                </div>

                <button
                  type="submit" disabled={loading}
                  className="mt-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
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
                <p className="text-xs text-zinc-400">No positions yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Symbol', 'Signal', 'Qty', 'Avg Price'].map(h => (
                        <th key={h} className="pb-2 text-left text-zinc-400 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="py-2 font-mono font-semibold text-zinc-900 dark:text-zinc-50">{p.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`py-2 font-semibold ${signalColor(p.signal)}`}>{p.signal}</td>
                        <td className="py-2 text-zinc-600 dark:text-zinc-300">{p.quantity}</td>
                        <td className="py-2 font-mono text-zinc-600 dark:text-zinc-300">₹{p.avg_price.toFixed(2)}</td>
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
                <p className="text-xs text-zinc-400">No orders placed yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Symbol', 'Signal', 'Qty', 'Fill Price', 'Status', ''].map(h => (
                        <th key={h} className="pb-2 text-left text-zinc-400 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="py-2 font-mono font-semibold text-zinc-900 dark:text-zinc-50">{o.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`py-2 font-semibold ${signalColor(o.signal)}`}>{o.signal}</td>
                        <td className="py-2 text-zinc-600 dark:text-zinc-300">{o.quantity}</td>
                        <td className="py-2 font-mono text-zinc-600 dark:text-zinc-300">
                          {o.fill_price ? `₹${o.fill_price.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor(o.status)}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {o.status === 'open' || o.status === 'pending' ? (
                            <button
                              onClick={() => handleCancel(o.broker_order_id ?? o.id)}
                              className="text-red-400 hover:text-red-600"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
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

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAlert, deleteAlert, listAlerts } from '@/lib/api'
import type { AlertRule } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

function dirLabel(dir: string) {
  return dir === 'above' ? '↑ above' : '↓ below'
}

function StatusBadge({ rule }: { rule: AlertRule }) {
  if (rule.triggered) {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
        Triggered
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
      Active
    </span>
  )
}

const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'

export default function AlertsView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [alerts, setAlerts] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)

  // Create form state
  const [newSymbol, setNewSymbol] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newDir, setNewDir] = useState<'above' | 'below'>('above')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    listAlerts(t).then(a => { setAlerts(a); setLoading(false) }).catch(() => setLoading(false))
  }, [router])

  async function remove(id: string) {
    await deleteAlert(tokenRef.current, id).catch(() => {})
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const price = parseFloat(newTarget)
    if (!newSymbol.trim() || isNaN(price) || price <= 0) {
      setCreateError('Symbol and a valid price are required.')
      return
    }
    setCreating(true)
    try {
      const created = await createAlert(tokenRef.current, newSymbol.trim().toUpperCase(), price, newDir)
      setAlerts(prev => [created, ...prev])
      setNewSymbol(''); setNewTarget('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  const active = alerts.filter(a => !a.triggered)
  const triggered = alerts.filter(a => a.triggered)

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Alerts" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Price Alerts</h1>

        {/* Create alert form */}
        <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Alert</h2>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-500">Symbol</label>
              <input
                value={newSymbol}
                onChange={e => setNewSymbol(e.target.value)}
                placeholder="RELIANCE"
                disabled={creating}
                className={`w-32 ${INPUT}`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-500">Direction</label>
              <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                {(['above', 'below'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNewDir(d)}
                    className={`px-3 py-2 text-xs font-medium transition-colors capitalize ${
                      newDir === d
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {d === 'above' ? '↑ Above' : '↓ Below'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-500">Target Price (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                placeholder="2500.00"
                disabled={creating}
                className={`w-32 ${INPUT}`}
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Set Alert'}
            </button>
          </form>
          {createError && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400">{createError}</p>
          )}
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        )}

        {!loading && alerts.length === 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              No alerts yet. Set one by clicking 🔔 on a watchlist row.
            </p>
          </div>
        )}

        {!loading && active.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Active ({active.length})
            </h2>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Symbol</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Condition</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Target</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {active.map(a => (
                    <tr key={a.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                        {a.symbol.replace(/\.(NS|BO)$/, '')}
                        <span className="ml-1 text-xs text-zinc-400">{a.symbol.endsWith('.NS') ? 'NSE' : 'BSE'}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{dirLabel(a.direction)}</td>
                      <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-50">₹{a.price_target.toFixed(2)}</td>
                      <td className="px-4 py-3"><StatusBadge rule={a} /></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => remove(a.id)}
                          className="text-xs text-zinc-400 hover:text-red-500"
                        >Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && triggered.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Triggered ({triggered.length})
            </h2>
            <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-amber-100 dark:border-amber-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Symbol</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Condition</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Target</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Triggered at</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {triggered.map(a => (
                    <tr key={a.id} className="border-b border-amber-100/50 last:border-0 dark:border-amber-800/30">
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                        {a.symbol.replace(/\.(NS|BO)$/, '')}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{dirLabel(a.direction)}</td>
                      <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-50">₹{a.price_target.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {a.triggered_at
                          ? new Date(a.triggered_at).toLocaleString('en-IN')
                          : '—'}
                        {a.triggered_price && (
                          <span className="ml-1 text-zinc-400">@ ₹{a.triggered_price.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => remove(a.id)}
                          className="text-xs text-zinc-400 hover:text-red-500"
                        >Clear</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

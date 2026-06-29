'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAlert, deleteAlert, listAlerts, searchStocks, getQuote } from '@/lib/api'
import type { AlertRule, StockSearchResult } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'

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

// ── Searchable stock picker ───────────────────────────────────────────────────

interface StockPickerProps {
  tokenRef: React.RefObject<string>
  // key prop from parent resets internal query when symbol is cleared
  onSelect: (symbol: string, name: string) => void
}

function StockPicker({ tokenRef, onSelect }: StockPickerProps) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<StockSearchResult[]>([])
  const [open, setOpen]         = useState(false)
  const debounce                = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef            = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      if (q.trim().length < 1) { setResults([]); setOpen(false); return }
      const res = await searchStocks(tokenRef.current, q).catch(() => [] as StockSearchResult[])
      setResults(res)
      setOpen(res.length > 0)
    }, 250)
  }

  function pick(r: StockSearchResult) {
    setQuery(r.name)
    setOpen(false)
    setResults([])
    onSelect(r.symbol, r.name)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Type stock name or ticker…"
        className={`w-56 ${INPUT}`}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.slice(0, 8).map(r => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={() => pick(r)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.name}</p>
                <p className="text-xs text-zinc-400">{r.symbol} · {r.exchange}</p>
              </div>
              <span className="text-xs text-zinc-400">{r.sector}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── LTP badge ─────────────────────────────────────────────────────────────────

function LTPBadge({ ltp, loading }: { ltp: number | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
    )
  }
  if (ltp === null) {
    return (
      <div className="flex items-center rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-600">
        <span className="text-xs text-zinc-400">LTP: select a stock</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/40">
      <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">LTP</span>
      <span className="font-mono text-sm font-bold text-indigo-700 dark:text-indigo-300">
        ₹{ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  )
}

// ── Distance pill for active alerts ──────────────────────────────────────────

function DistancePill({ ltp, target, direction }: { ltp: number; target: number; direction: string }) {
  const dist = ((target - ltp) / ltp) * 100
  const hit = direction === 'above' ? ltp >= target : ltp <= target
  if (hit) return <span className="text-xs font-semibold text-amber-500">At target</span>
  const sign = dist > 0 ? '+' : ''
  const color = direction === 'above'
    ? (dist > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')
    : (dist < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')
  return (
    <span className={`font-mono text-xs font-semibold ${color}`}>
      {sign}{dist.toFixed(2)}%
    </span>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function AlertsView() {
  const router     = useRouter()
  const tokenRef   = useRef('')
  const [alerts, setAlerts]     = useState<AlertRule[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Form state
  const [selSymbol, setSelSymbol] = useState('')   // e.g. "RELIANCE.NS"
  const [selLabel, setSelLabel]   = useState('')   // e.g. "Reliance Industries"
  const [ltp, setLtp]             = useState<number | null>(null)
  const [ltpLoading, setLtpLoading] = useState(false)
  const [newTarget, setNewTarget] = useState('')
  const [newDir, setNewDir]       = useState<'above' | 'below'>('above')

  // Live LTP for active alerts (symbol → price)
  const [livePrices, setLivePrices] = useState<Record<string, number>>({})

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    listAlerts(t)
      .then(a => setAlerts(a))
      .catch(() => setAlerts([]))
  }, [router])

  // Refresh live prices for active alerts every 30 s
  useEffect(() => {
    if (!alerts) return
    const active = alerts.filter(a => !a.triggered)
    if (active.length === 0) return

    async function refresh() {
      const symbols = [...new Set(active.map(a => a.symbol))]
      const results = await Promise.allSettled(
        symbols.map(s => getQuote(tokenRef.current, s))
      )
      const prices: Record<string, number> = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') prices[symbols[i]] = r.value.price
      })
      setLivePrices(prices)
    }

    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [alerts])

  // Auto-detect direction when target changes
  function handleTargetChange(val: string) {
    setNewTarget(val)
    const price = parseFloat(val)
    if (!isNaN(price) && ltp !== null) {
      setNewDir(price >= ltp ? 'above' : 'below')
    }
  }

  // Fetch LTP when a stock is selected
  function handleSelect(symbol: string, name: string) {
    setSelSymbol(symbol)
    setSelLabel(name)
    setLtp(null)
    setLtpLoading(true)
    getQuote(tokenRef.current, symbol)
      .then(q => {
        setLtp(q.price)
        // Pre-fill direction if target already typed
        const price = parseFloat(newTarget)
        if (!isNaN(price)) setNewDir(price >= q.price ? 'above' : 'below')
      })
      .catch(() => null)
      .finally(() => setLtpLoading(false))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const price = parseFloat(newTarget)
    if (!selSymbol) { setCreateError('Please select a stock from the dropdown.'); return }
    if (isNaN(price) || price <= 0) { setCreateError('Enter a valid target price.'); return }
    setCreating(true)
    try {
      const created = await createAlert(tokenRef.current, selSymbol, price, newDir)
      setAlerts(prev => [created, ...(prev ?? [])])
      setSelSymbol(''); setSelLabel(''); setLtp(null); setNewTarget('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create alert')
    } finally { setCreating(false) }
  }

  async function remove(id: string) {
    await deleteAlert(tokenRef.current, id).catch(() => {})
    setAlerts(prev => (prev ?? []).filter(a => a.id !== id))
  }

  const active    = (alerts ?? []).filter(a => !a.triggered)
  const triggered = (alerts ?? []).filter(a => a.triggered)

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Alerts" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Price Alerts</h1>

        {/* ── Create form ── */}
        <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Alert</h2>
          <form onSubmit={handleCreate}>
            {/* Row 1: stock picker + LTP */}
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Stock</label>
                {/* key resets internal query state when form is cleared after submit */}
                <StockPicker
                  key={selSymbol || 'empty'}
                  tokenRef={tokenRef}
                  onSelect={handleSelect}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Live Price</label>
                <LTPBadge ltp={ltp} loading={ltpLoading} />
              </div>
            </div>

            {/* Row 2: direction + target + button */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Alert when price is</label>
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-600">
                  {(['above', 'below'] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setNewDir(d)}
                      className={`px-4 py-2 text-xs font-medium transition-colors ${
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
                <label className="text-xs font-medium text-zinc-500">
                  Target Price (₹)
                  {ltp !== null && (
                    <span className="ml-2 text-zinc-400">
                      {newTarget && !isNaN(parseFloat(newTarget))
                        ? `${((parseFloat(newTarget) - ltp) / ltp * 100).toFixed(2)}% from LTP`
                        : 'enter target'}
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.01"
                  value={newTarget}
                  onChange={e => handleTargetChange(e.target.value)}
                  placeholder={ltp !== null ? ltp.toFixed(2) : '0.00'}
                  disabled={creating}
                  className={`w-36 ${INPUT}`}
                />
              </div>

              <button
                type="submit"
                disabled={creating || !selSymbol}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Setting…' : '🔔 Set Alert'}
              </button>
            </div>

            {createError && (
              <p className="mt-2 text-xs text-red-500 dark:text-red-400">{createError}</p>
            )}
          </form>
        </div>

        {/* ── Loading skeleton ── */}
        {alerts === null && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {alerts !== null && alerts.length === 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">No alerts yet. Select a stock above and set your first alert.</p>
          </div>
        )}

        {/* ── Active alerts ── */}
        {active.length > 0 && (
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">LTP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Distance</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {active.map(a => {
                    const price = livePrices[a.symbol]
                    return (
                      <tr key={a.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                            {a.symbol.replace(/\.(NS|BO)$/, '')}
                          </p>
                          <p className="text-[10px] text-zinc-400">{a.symbol.endsWith('.NS') ? 'NSE' : 'BSE'}</p>
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                          {a.direction === 'above' ? '↑ above' : '↓ below'}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                          ₹{a.price_target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-300">
                          {price != null
                            ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {price != null
                            ? <DistancePill ltp={price} target={a.price_target} direction={a.direction} />
                            : <span className="text-zinc-300 dark:text-zinc-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge rule={a} /></td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => remove(a.id)} className="text-xs text-zinc-400 hover:text-red-500">
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Triggered alerts ── */}
        {triggered.length > 0 && (
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
                      <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">
                        {a.symbol.replace(/\.(NS|BO)$/, '')}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                        {a.direction === 'above' ? '↑ above' : '↓ below'}
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-50">
                        ₹{a.price_target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {a.triggered_at ? new Date(a.triggered_at).toLocaleString('en-IN') : '—'}
                        {a.triggered_price && (
                          <span className="ml-1 font-mono text-zinc-400">
                            @ ₹{a.triggered_price.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => remove(a.id)} className="text-xs text-zinc-400 hover:text-red-500">
                          Clear
                        </button>
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

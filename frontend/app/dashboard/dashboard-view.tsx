'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addItemToWatchlist,
  createWatchlist,
  deleteWatchlist,
  getMe,
  getQuote,
  getWatchlistItems,
  listWatchlists,
  removeItemFromWatchlist,
  renameWatchlist,
  seedWatchlistDefaults,
} from '@/lib/api'
import type { Quote, User, Watchlist, WatchlistItem } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

type Signal = 'BUY' | 'HOLD' | 'SELL'

function computeSignal(q: Quote): { score: number; signal: Signal } {
  const range = q.day_high - q.day_low
  const pos = range > 0 ? (q.price - q.day_low) / range : 0.5
  const raw = 50 + q.change_pct * 6 + (pos - 0.5) * 20
  const score = Math.round(Math.min(100, Math.max(0, raw)))
  return { score, signal: score >= 60 ? 'BUY' : score <= 40 ? 'SELL' : 'HOLD' }
}

function SignalBadge({ signal }: { signal: Signal }) {
  const cls =
    signal === 'BUY'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
      : signal === 'SELL'
        ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
        : 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${cls}`}>
      {signal}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-emerald-500' : score <= 40 ? 'bg-red-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 text-right text-xs text-zinc-500">{score}</span>
    </div>
  )
}

export default function DashboardView() {
  const router = useRouter()
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<User | null>(null)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})

  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)

  // Create-watchlist inline form
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  // Rename inline
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  // Add symbol form
  const [addSymbol, setAddSymbol] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const fetchQuotes = useCallback(async (wl: WatchlistItem[]) => {
    if (wl.length === 0) return
    const results = await Promise.allSettled(wl.map(i => getQuote(tokenRef.current, i.symbol)))
    setQuotes(prev => {
      const next = { ...prev }
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') next[wl[idx].symbol] = r.value
      })
      return next
    })
  }, [])

  const loadItems = useCallback(
    async (id: string) => {
      setItemsLoading(true)
      try {
        const wl = await getWatchlistItems(tokenRef.current, id)
        setItems(wl)
        await fetchQuotes(wl)
      } finally {
        setItemsLoading(false)
      }
    },
    [fetchQuotes],
  )

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t

    Promise.all([getMe(t), listWatchlists(t)])
      .then(async ([me, wls]) => {
        setUser(me)

        if (wls.length === 0) {
          // New user — create a default watchlist and seed it
          const created = await createWatchlist(t, 'My Watchlist')
          await seedWatchlistDefaults(t, created.id)
          const updated = await listWatchlists(t)
          setWatchlists(updated)
          setActiveId(created.id)
          await loadItems(created.id)
        } else {
          setWatchlists(wls)
          setActiveId(wls[0].id)
          await loadItems(wls[0].id)
        }
      })
      .catch(() => {
        localStorage.removeItem('mts_token')
        router.replace('/login')
      })
      .finally(() => setLoading(false))
  }, [router, loadItems])

  // Refresh quotes every 30 s
  useEffect(() => {
    if (items.length === 0) return
    const id = setInterval(() => fetchQuotes(items), 30_000)
    return () => clearInterval(id)
  }, [items, fetchQuotes])

  async function switchWatchlist(id: string) {
    setActiveId(id)
    setQuotes({})
    await loadItems(id)
  }

  async function handleCreateWatchlist() {
    const name = newName.trim()
    if (!name) return
    setCreateError(null)
    try {
      const wl = await createWatchlist(tokenRef.current, name)
      setWatchlists(prev => [...prev, wl])
      setNewName('')
      setCreating(false)
      await switchWatchlist(wl.id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function handleRename(id: string) {
    const name = renameVal.trim()
    if (!name) { setRenamingId(null); return }
    try {
      const updated = await renameWatchlist(tokenRef.current, id, name)
      setWatchlists(prev => prev.map(w => (w.id === id ? updated : w)))
    } catch {
      // ignore
    } finally {
      setRenamingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this watchlist and all its items?')) return
    await deleteWatchlist(tokenRef.current, id)
    const remaining = watchlists.filter(w => w.id !== id)
    setWatchlists(remaining)
    if (activeId === id) {
      if (remaining.length > 0) {
        setActiveId(remaining[0].id)
        await loadItems(remaining[0].id)
      } else {
        setActiveId(null)
        setItems([])
      }
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addSymbol.trim() || !activeId) return
    setAddLoading(true)
    setAddError(null)
    try {
      const item = await addItemToWatchlist(tokenRef.current, activeId, addSymbol.trim())
      setItems(prev => [item, ...prev])
      setAddSymbol('')
      const q = await getQuote(tokenRef.current, item.symbol).catch(() => null)
      if (q) setQuotes(prev => ({ ...prev, [item.symbol]: q }))
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add symbol')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleRemove(symbol: string) {
    if (!activeId) return
    try {
      await removeItemFromWatchlist(tokenRef.current, activeId, symbol)
      setItems(prev => prev.filter(i => i.symbol !== symbol))
      setQuotes(prev => { const n = { ...prev }; delete n[symbol]; return n })
    } catch {
      if (activeId) await loadItems(activeId)
    }
  }

  const activeWatchlist = watchlists.find(w => w.id === activeId)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Watchlist" />

      <div className="mx-auto flex max-w-7xl gap-0 px-4 py-6">
        {/* ── Sidebar ── */}
        <aside className="w-52 shrink-0 pr-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Watchlists
            </span>
            <button
              onClick={() => { setCreating(true); setNewName(''); setCreateError(null) }}
              title="Create watchlist"
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              +
            </button>
          </div>

          <ul className="space-y-0.5">
            {watchlists.map(wl => (
              <li key={wl.id}>
                {renamingId === wl.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onBlur={() => handleRename(wl.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(wl.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="w-full rounded border border-indigo-400 px-2 py-1 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
                  />
                ) : (
                  <div
                    className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm ${
                      activeId === wl.id
                        ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                    }`}
                    onClick={() => switchWatchlist(wl.id)}
                  >
                    <span className="truncate">{wl.name}</span>
                    <span className="hidden gap-0.5 group-hover:flex">
                      <button
                        title="Rename"
                        onClick={e => {
                          e.stopPropagation()
                          setRenamingId(wl.id)
                          setRenameVal(wl.name)
                        }}
                        className="rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        ✎
                      </button>
                      <button
                        title="Delete"
                        onClick={e => { e.stopPropagation(); handleDelete(wl.id) }}
                        className="rounded px-1 text-zinc-400 hover:text-red-500"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {creating && (
            <div className="mt-2 flex flex-col gap-1">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateWatchlist()
                  if (e.key === 'Escape') setCreating(false)
                }}
                placeholder="Watchlist name"
                className="w-full rounded border border-indigo-400 px-2 py-1 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
              />
              {createError && <p className="text-xs text-red-500">{createError}</p>}
              <div className="flex gap-1">
                <button
                  onClick={handleCreateWatchlist}
                  className="flex-1 rounded bg-indigo-600 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Create
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="flex-1 rounded bg-zinc-200 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* ── Main area ── */}
        <main className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {activeWatchlist?.name ?? 'Select a watchlist'}
            </h1>
            <p className="text-xs text-zinc-400">Live price · refreshes every 30 s</p>
          </div>

          {/* Add symbol form */}
          {activeId && (
            <form onSubmit={handleAdd} className="mb-4 flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <input
                  value={addSymbol}
                  onChange={e => setAddSymbol(e.target.value)}
                  placeholder="e.g. RELIANCE or TCS.NS"
                  disabled={addLoading}
                  className="w-60 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
                {addError && <p className="text-xs text-red-600">{addError}</p>}
              </div>
              <button
                type="submit"
                disabled={addLoading || !addSymbol.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addLoading ? 'Adding…' : 'Add symbol'}
              </button>
            </form>
          )}

          {/* Items table */}
          {!activeId ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-400">
                {watchlists.length === 0
                  ? 'Create your first watchlist using the + button.'
                  : 'Select a watchlist from the sidebar.'}
              </p>
            </div>
          ) : itemsLoading ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-400">Loading…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-400">
                This watchlist is empty. Add a symbol above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                    <th className="px-4 py-3 text-xs font-medium text-zinc-500">Symbol</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Change</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">High</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Low</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Volume</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500">Score</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500">Signal</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {items.map(item => {
                    const q = quotes[item.symbol]
                    const up = q ? q.change >= 0 : null
                    const sig = q ? computeSignal(q) : null
                    return (
                      <tr
                        key={item.id}
                        className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-zinc-900 dark:text-zinc-50">
                            {item.symbol.replace(/\.(NS|BO)$/, '')}
                          </span>
                          <span className="ml-2 text-xs text-zinc-400">{item.exchange}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-900 dark:text-zinc-50">
                          {q ? `₹${q.price.toFixed(2)}` : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono text-xs ${
                            up === null
                              ? 'text-zinc-400'
                              : up
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-500 dark:text-red-400'
                          }`}
                        >
                          {q
                            ? `${up ? '+' : ''}${q.change.toFixed(2)} (${up ? '+' : ''}${q.change_pct.toFixed(2)}%)`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                          {q ? `₹${q.day_high.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                          {q ? `₹${q.day_low.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                          {q ? q.volume.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {sig ? (
                            <ScoreBar score={sig.score} />
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {sig ? (
                            <SignalBadge signal={sig.signal} />
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleRemove(item.symbol)}
                            aria-label={`Remove ${item.symbol}`}
                            className="text-zinc-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {user && (
            <p className="mt-3 text-right text-xs text-zinc-400">{user.full_name}</p>
          )}
        </main>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { listWatchlists, getWatchlistItems } from '@/lib/api'
import type { Watchlist, WatchlistItem, StockSearchResult } from '@/lib/api'

export function WatchlistPicker({
  token, selectedSymbol, onSelect,
}: {
  token: string
  selectedSymbol?: string
  onSelect: (r: StockSearchResult) => void
}) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    listWatchlists(token).then(wls => {
      setWatchlists(wls)
      if (wls.length > 0) setActiveId(wls[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!token || !activeId) return
    getWatchlistItems(token, activeId).then(setItems).catch(() => setItems([]))
  }, [token, activeId])

  if (loading || watchlists.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Or pick from a watchlist</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {watchlists.map(wl => (
          <button
            key={wl.id}
            onClick={() => setActiveId(wl.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              activeId === wl.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {wl.name}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-zinc-400">No stocks in this watchlist yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => {
            const isActive = selectedSymbol === item.symbol
            return (
              <button
                key={item.symbol}
                onClick={() => onSelect({ symbol: item.symbol, name: '', sector: '', exchange: item.exchange })}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30'
                }`}
              >
                {item.symbol.replace('.NS', '').replace('.BO', '')}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

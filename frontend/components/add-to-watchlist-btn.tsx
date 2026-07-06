'use client'

import { useEffect, useRef, useState } from 'react'
import { addItemToWatchlist } from '@/lib/api'
import type { Watchlist } from '@/lib/api'

export function AddToWatchlistBtn({
  symbol, token, watchlists,
}: {
  symbol: string
  token: string
  watchlists: Watchlist[]
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (watchlists.length === 0) return null

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  async function add(wlId: string) {
    setAdding(true)
    setOpen(false)
    try {
      await addItemToWatchlist(token, wlId, symbol)
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } catch { /* already in watchlist */ }
    setAdding(false)
  }

  return (
    <>
      <button ref={btnRef} onClick={handleOpen} disabled={adding}
        title="Add to watchlist"
        className={`text-[10px] font-semibold whitespace-nowrap transition-colors ${
          added
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-violet-500 hover:text-violet-700 dark:hover:text-violet-300'
        }`}>
        {added ? '✓ Added' : adding ? '…' : '+ WL'}
      </button>
      {open && (
        <div ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="min-w-[140px] rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <p className="border-b border-zinc-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
            Add to watchlist
          </p>
          {watchlists.map(wl => (
            <button key={wl.id} onClick={() => add(wl.id)}
              className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-zinc-300 dark:hover:bg-indigo-950/30">
              {wl.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getStrategyDashboardLevels } from '@/lib/api'
import type { StrategyDashboardLevelsRow } from '@/lib/api'

const POLL_MS = 15_000

function panelHref(contract: string): string {
  if (contract === 'GOLDGUINEA') return '/mcx/metals/goldguinea'
  if (contract === 'SILVER100') return '/mcx/metals/silver100'
  return '/mcx/ngmini'
}

function fmtPrice(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function PriceCard({ row }: { row: StrategyDashboardLevelsRow }) {
  const up = (row.change_pct ?? 0) >= 0
  const changeColor = row.change_pct === null ? 'text-zinc-400' : up ? 'text-emerald-500' : 'text-red-500'

  return (
    <a
      href={panelHref(row.contract)}
      className="block rounded-2xl border border-zinc-200 bg-white p-6 no-underline shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          <span className="text-xl">{row.icon}</span> {row.name}
        </p>
        <span className="text-[11px] text-zinc-400">{timeAgo(row.updated_at)}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-5xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
          {fmtPrice(row.ltp)}
        </span>
        {row.change_pct !== null && (
          <span className={`text-lg font-bold tabular-nums ${changeColor}`}>
            {up ? '+' : ''}{row.change_pct.toFixed(2)}%
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
          <p className="text-zinc-400">Open</p>
          <p className="mt-0.5 font-mono font-semibold text-zinc-700 dark:text-zinc-200">{fmtPrice(row.open)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
          <p className="text-zinc-400">Prev Close</p>
          <p className="mt-0.5 font-mono font-semibold text-zinc-700 dark:text-zinc-200">{fmtPrice(row.prev_close)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
          <p className="text-zinc-400">Day High</p>
          <p className="mt-0.5 font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtPrice(row.day_high)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
          <p className="text-zinc-400">Day Low</p>
          <p className="mt-0.5 font-mono font-semibold text-red-500 dark:text-red-400">{fmtPrice(row.day_low)}</p>
        </div>
      </div>

      <p className="mt-4 text-right text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
        Open strategy panel →
      </p>
    </a>
  )
}

export default function McxLivePricesView() {
  const [rows, setRows] = useState<StrategyDashboardLevelsRow[] | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getStrategyDashboardLevels(t)
        .then(r => { setRows(r.rows); setGeneratedAt(r.generated_at); setErr(null) })
        .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load live prices'))
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">🔴 Live Prices</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              LTP for Gold Guinea, Silver100, and NG Mini at a glance — no chart clutter, just the number.
            </p>
          </div>
          {generatedAt && (
            <p className="text-xs text-zinc-400">
              Refreshes every {POLL_MS / 1000}s &middot; updated {timeAgo(generatedAt)}
            </p>
          )}
        </div>

        {err && (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {err}
          </div>
        )}

        {rows === null && !err ? (
          <div className="flex justify-center py-24">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows?.map(row => <PriceCard key={row.contract} row={row} />)}
          </div>
        )}
      </div>
    </div>
  )
}

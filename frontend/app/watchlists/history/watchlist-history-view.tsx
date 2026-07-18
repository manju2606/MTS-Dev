'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { getWatchlistHistoryPicks } from '@/lib/api'
import type { WatchlistHistoryPick, WatchlistHistorySource } from '@/lib/api'
import { buildMonthlyPnlRows, buildWeeklyPnlRows } from '@/lib/watchlist-history-rollup'

const SOURCE_LABEL: Record<WatchlistHistorySource, string> = {
  SOTD: 'Stock of the Day',
  BTST: 'BTST',
  GOLDEN_STOCK: 'Golden Stock — Intraday',
}

const SOURCE_FILTERS: { id: WatchlistHistorySource | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'SOTD', label: 'Stock of the Day' },
  { id: 'BTST', label: 'BTST' },
  { id: 'GOLDEN_STOCK', label: 'Golden Stock — Intraday' },
]

type Period = 'DAY' | 'WEEK' | 'MONTH'

function fmtINR(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PnlBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-400">—</span>
  const pos = pct >= 0
  return (
    <span className={pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

type Row = {
  pick: WatchlistHistoryPick
  periodKey: string
  periodLabel: string
  price: number | null
  pnl_pct: number | null
}

function rowsForPick(pick: WatchlistHistoryPick, period: Period): Row[] {
  if (period === 'DAY') {
    return [{
      pick,
      periodKey: pick.last_snapshot_date ?? pick.announced_date,
      periodLabel: pick.last_snapshot_date ?? 'No snapshot yet',
      price: pick.last_price,
      pnl_pct: pick.last_pnl_pct,
    }]
  }
  const periodRows = period === 'WEEK' ? buildWeeklyPnlRows(pick) : buildMonthlyPnlRows(pick)
  if (periodRows.length === 0) {
    return [{ pick, periodKey: pick.announced_date, periodLabel: 'No snapshot yet', price: null, pnl_pct: null }]
  }
  return periodRows.map(r => ({ pick, periodKey: r.key, periodLabel: r.label, price: r.price, pnl_pct: r.pnl_pct }))
}

export default function WatchlistHistoryView() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [picks, setPicks] = useState<WatchlistHistoryPick[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<WatchlistHistorySource | 'ALL'>('ALL')
  const [period, setPeriod] = useState<Period>('DAY')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    setToken(t)
  }, [router])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    getWatchlistHistoryPicks(token, { limit: 500 })
      .then(setPicks)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load watchlist history'))
      .finally(() => setLoading(false))
  }, [token])

  const filteredPicks = useMemo(
    () => (source === 'ALL' ? picks : picks.filter(p => p.source === source)),
    [picks, source],
  )

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const pick of filteredPicks) out.push(...rowsForPick(pick, period))
    return out.sort((a, b) => {
      const byPeriod = b.periodKey.localeCompare(a.periodKey)
      return byPeriod !== 0 ? byPeriod : b.pick.announced_date.localeCompare(a.pick.announced_date)
    })
  }, [filteredPicks, period])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Trading" />
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Watchlist History</h1>
        <p className="text-[11px] text-zinc-400">
          Stock of the Day · BTST · Golden Stock picks tracked daily since announcement, up to 30 trading days
        </p>
        <div className="mt-2 flex gap-1">
          <Link
            href="/watchlists"
            className="rounded-md px-3 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Watchlists
          </Link>
          <span className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
            History
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {SOURCE_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setSource(f.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  source === f.id
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                    : 'bg-white text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(['DAY', 'WEEK', 'MONTH'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  period === p
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {p === 'DAY' ? 'Day' : p === 'WEEK' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="py-12 text-center text-xs text-zinc-400">Loading…</p>
        ) : error ? (
          <p className="py-12 text-center text-xs text-red-500">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-zinc-400">
            No tracked picks yet — this fills in once Stock of the Day, BTST, or Golden Stock generate a pick and the daily ingest job runs (~15:40 IST).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Source', 'Symbol', 'Announced', period === 'DAY' ? 'Last Updated' : period === 'WEEK' ? 'Week' : 'Month', 'Buy Price', 'Price', '% P&L', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {rows.map((r, i) => (
                  <tr key={`${r.pick.id}-${r.periodKey}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="px-3 py-2.5 text-zinc-500">{SOURCE_LABEL[r.pick.source]}</td>
                    <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{r.pick.symbol}</td>
                    <td className="px-3 py-2.5 font-mono text-zinc-500">{r.pick.announced_date}</td>
                    <td className="px-3 py-2.5 font-mono text-zinc-500">{r.periodLabel}</td>
                    <td className="px-3 py-2.5 font-mono">{fmtINR(r.pick.buy_price)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.price !== null ? fmtINR(r.price) : '—'}</td>
                    <td className="px-3 py-2.5 font-mono"><PnlBadge pct={r.pnl_pct} /></td>
                    <td className="px-3 py-2.5">
                      {r.pick.frozen ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Frozen
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                          Day {r.pick.trading_day_count}/{r.pick.window_days}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getMyTradingDashboard } from '@/lib/api'
import type { McxDashboardRow, McxRankedDashboard } from '@/lib/api'

const POLL_MS = 20_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

const VERDICT_STYLE: Record<McxDashboardRow['verdict'], string> = {
  TRADE: 'bg-emerald-600 text-white',
  WATCHLIST: 'bg-amber-500 text-white',
  NO_TRADE: 'bg-zinc-400 text-white',
}
const TILE_ACCENT: Record<McxDashboardRow['verdict'], string> = {
  TRADE: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30',
  WATCHLIST: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
  NO_TRADE: 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
}

function PctChange({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-400">—</span>
  const pos = pct >= 0
  return (
    <span className={pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
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

function HeatTile({ row, rank }: { row: McxDashboardRow; rank: number }) {
  return (
    <div className={`rounded-2xl border p-4 text-center shadow-sm ${TILE_ACCENT[row.verdict]}`}>
      <div className="text-lg">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</div>
      <div className="mt-1 text-2xl">{row.icon}</div>
      <p className="mt-1 truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{row.name}</p>
      <p className="mt-1 text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
        {(row.ai_score_pct / 10).toFixed(1)}/10
      </p>
      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${VERDICT_STYLE[row.verdict]}`}>
        {row.ai_score_pct.toFixed(0)}% · {row.verdict === 'NO_TRADE' ? 'HOLD' : row.direction}
      </span>
    </div>
  )
}

const PRED_COLS: { key: keyof McxDashboardRow['predicted']; label: string }[] = [
  { key: '1m', label: '1m' },
  { key: '15m', label: '15m' },
  { key: '30m', label: '30m' },
  { key: '1h', label: '1H' },
]

function RankRow({ row, rank }: { row: McxDashboardRow; rank: number }) {
  return (
    <tr className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
      <td className="whitespace-nowrap px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-200">
        {RANK_MEDALS[rank] ?? rank + 1}
      </td>
      <td className="px-3 py-2">
        <span className="mr-1">{row.icon}</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{row.name}</span>
      </td>
      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{fmtPrice(row.ltp)}</td>
      <td className="px-3 py-2"><PctChange pct={row.change_pct} /></td>
      <td className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-100">{row.ai_score_pct.toFixed(1)}%</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${VERDICT_STYLE[row.verdict]}`}>
          {row.verdict === 'NO_TRADE' ? 'HOLD' : row.direction}
        </span>
      </td>
      {PRED_COLS.map(c => (
        <td key={c.key} className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
          {fmtPrice(row.predicted[c.key])}
        </td>
      ))}
    </tr>
  )
}

export default function MyTradingDashboardView() {
  const [data, setData] = useState<McxRankedDashboard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      setData(await getMyTradingDashboard(token, 10))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load dashboard')
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const ranked = data?.ranked ?? []

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="My Trading Dashboard" />
      <div className="mx-auto max-w-7xl px-4 py-8">

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">📈 My Trading Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Every tracked MCX contract (Natural Gas + Base &amp; Precious Metals), ranked together by AI Strength.
            </p>
          </div>
          {data && (
            <div className="text-right text-xs text-zinc-400">
              <p>Prices refresh every {POLL_MS / 1000}s · updated {timeAgo(data.generated_at)}</p>
              <p>AI Strength refreshes every ~5 min · showing top {ranked.length} of {data.total_tracked} scored ({data.total_contracts} tracked)</p>
            </div>
          )}
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {err}
          </div>
        )}

        {data === null && !err ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : ranked.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
            No AI-scored contracts yet — the background signal-check job scores every tracked contract every ~5 min;
            check back shortly, or visit the{' '}
            <a href="/mcx" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Natural Gas</a>{' '}
            or{' '}
            <a href="/mcx/metals" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Metals</a>{' '}
            page to trigger the first score.
          </div>
        ) : (
          <>
            <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">🔥 AI Heat Map</h2>
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {ranked.map((row, i) => <HeatTile key={row.contract} row={row} rank={i} />)}
            </div>

            <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">📊 Ranked Dashboard</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    {['Rank', 'Commodity', 'LTP', 'Chg%', 'AI Score', 'Signal', '1m', '15m', '30m', '1H'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-zinc-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((row, i) => <RankRow key={row.contract} row={row} rank={i} />)}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-zinc-400">
              Predicted prices (1m/15m/30m/1H) are the NG-AI Pro / Metals-AI Pro local heuristic
              (EMA slope + ROC momentum + ATR cone, not a trained model) — see the{' '}
              <a href="/mcx" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Natural Gas</a>{' '}
              or{' '}
              <a href="/mcx/metals" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Metals</a>{' '}
              page for full accuracy tracking. A dash (—) means not enough candle history yet for that timeframe.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

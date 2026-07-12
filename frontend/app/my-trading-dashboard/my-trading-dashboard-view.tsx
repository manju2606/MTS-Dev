'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getMyTradingDashboard } from '@/lib/api'
import type { McxDashboardRow, McxRankedDashboard } from '@/lib/api'

const POLL_MS = 20_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Same palette as AI_Commodity_Trading_Dashboard_Pro_v3.html: tiles shade
// from emerald (best rank) to dark red (worst) regardless of verdict, and
// buy/hold/sell get fixed colors in the table -- ranks beyond the
// mockup's 5 defined tiers reuse the last (dark red) tier.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f', '#b45309', '#991b1b']
const SIGNAL_COLOR: Record<'BUY' | 'HOLD' | 'SELL', string> = {
  BUY: '#22c55e',
  HOLD: '#facc15',
  SELL: '#ef4444',
}

function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

function signalOf(row: McxDashboardRow): 'BUY' | 'HOLD' | 'SELL' {
  return row.verdict === 'NO_TRADE' ? 'HOLD' : row.direction
}

function PctChange({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: '#64748b' }}>—</span>
  const pos = pct >= 0
  return (
    <span style={{ color: pos ? '#22c55e' : '#ef4444' }}>
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
  const signal = signalOf(row)
  return (
    <div
      className="rounded-2xl p-4 text-center font-bold shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
      style={{ background: tileColor(rank), color: '#eef2ff' }}
    >
      <div className="text-lg">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</div>
      <div className="mt-1 text-2xl">{row.icon}</div>
      <p className="mt-1 truncate text-xs">{row.name}</p>
      <p className="mt-1 text-xl font-extrabold">{(row.ai_score_pct / 10).toFixed(1)}/10</p>
      <p className="mt-1 text-xs">{row.ai_score_pct.toFixed(0)}% &middot; {signal}</p>
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
  const signal = signalOf(row)
  return (
    <tr style={{ borderBottom: '1px solid #24324d' }}>
      <td className="px-2 py-2 text-center">{RANK_MEDALS[rank] ?? rank + 1}</td>
      <td className="px-2 py-2 text-center">
        <span className="mr-1">{row.icon}</span>{row.name}
      </td>
      <td className="px-2 py-2 text-center">{fmtPrice(row.ltp)}</td>
      <td className="px-2 py-2 text-center"><PctChange pct={row.change_pct} /></td>
      <td className="px-2 py-2 text-center font-semibold">{row.ai_score_pct.toFixed(1)}%</td>
      <td className="px-2 py-2 text-center font-bold" style={{ color: SIGNAL_COLOR[signal] }}>
        {signal}
      </td>
      {PRED_COLS.map(c => (
        <td key={c.key} className="px-2 py-2 text-center" style={{ color: '#94a3b8' }}>
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
    <div className="min-h-screen" style={{ background: '#0b1220', color: '#eef2ff' }}>
      <NavBar active="My Trading Dashboard" />

      <div
        className="px-4 py-4 text-center text-xl font-bold sm:text-2xl"
        style={{ background: 'linear-gradient(90deg,#2563eb,#7c3aed,#06b6d4)' }}
      >
        📈 My Trading Dashboard
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm" style={{ color: '#cbd5e1' }}>
            Every tracked MCX contract (Natural Gas + Base &amp; Precious Metals), ranked together by AI Strength.
          </p>
          {data && (
            <div className="text-right text-xs" style={{ color: '#64748b' }}>
              <p>Prices refresh every {POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)}</p>
              <p>AI Strength refreshes every ~5 min &middot; showing top {ranked.length} of {data.total_tracked} scored ({data.total_contracts} tracked)</p>
            </div>
          )}
        </div>

        {err && (
          <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>
            {err}
          </div>
        )}

        {data === null && !err ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        ) : ranked.length === 0 ? (
          <div className="rounded-xl px-4 py-10 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
            No AI-scored contracts yet — the background signal-check job scores every tracked contract every ~5 min;
            check back shortly, or visit the{' '}
            <a href="/mcx" className="font-medium text-indigo-400 hover:underline">Natural Gas</a>{' '}
            or{' '}
            <a href="/mcx/metals" className="font-medium text-indigo-400 hover:underline">Metals</a>{' '}
            page to trigger the first score.
          </div>
        ) : (
          <>
            <h2 className="mb-3 text-base font-bold">🔥 AI Heat Map (Automatically Ranked by AI Strength)</h2>
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {ranked.map((row, i) => <HeatTile key={row.contract} row={row} rank={i} />)}
            </div>

            <h2 className="mb-3 text-base font-bold">📊 Ranked Commodity Dashboard</h2>
            <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: '#1e3a8a' }}>
                    {['Rank', 'Commodity', 'LTP', 'Chg%', 'AI Score', 'Signal', '1m', '15m', '30m', '1H'].map(h => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-center font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((row, i) => <RankRow key={row.contract} row={row} rank={i} />)}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs" style={{ color: '#64748b' }}>
              Predicted prices (1m/15m/30m/1H) are the NG-AI Pro / Metals-AI Pro local heuristic
              (EMA slope + ROC momentum + ATR cone, not a trained model) — see the{' '}
              <a href="/mcx" className="font-medium text-indigo-400 hover:underline">Natural Gas</a>{' '}
              or{' '}
              <a href="/mcx/metals" className="font-medium text-indigo-400 hover:underline">Metals</a>{' '}
              page for full accuracy tracking. A dash (—) means not enough candle history yet for that timeframe.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

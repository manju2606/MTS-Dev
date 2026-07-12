'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getInternationalMarketDashboard } from '@/lib/api'
import type { InternationalMarketRow, InternationalMarketTrend } from '@/lib/api'

const POLL_MS = 30_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Same rank-tiered palette as My Trading Dashboard/Crypto/USA Stocks
// (matching AI_Commodity_Trading_Dashboard_Pro_v3.html): best AI Score
// emerald, worst dark red.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f', '#b45309', '#991b1b']
function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

const TREND_COLOR: Record<InternationalMarketTrend, string> = {
  Bullish: '#22c55e',
  Bearish: '#ef4444',
  Neutral: '#94a3b8',
}
const TREND_ARROW: Record<InternationalMarketTrend, string> = {
  Bullish: '▲',
  Bearish: '▼',
  Neutral: '—',
}

// Index levels aren't a single currency (FTSE is GBP-based, Nikkei
// JPY-based, DAX EUR-based, etc.) -- shown as plain index points, no
// currency symbol, unlike USA Stocks'/Crypto's $ prices.
function fmtLevel(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
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

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function HeatTile({ row, rank }: { row: InternationalMarketRow; rank: number }) {
  return (
    <div
      className="rounded-2xl p-4 text-center font-bold shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
      style={{ background: tileColor(rank), color: '#eef2ff' }}
    >
      <div className="text-lg">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</div>
      <div className="mt-1 text-sm">{row.name}</div>
      <p className="text-[10px] font-normal opacity-80">{row.region}</p>
      <p className="mt-2 text-xl font-extrabold">{fmtLevel(row.price)}</p>
      <p className="mt-1 text-xs">
        <span style={{ color: TREND_COLOR[row.trend] }}>{TREND_ARROW[row.trend]} {row.trend}</span>
      </p>
      <p className="mt-1 text-xs opacity-90">AI Score {row.ai_score}</p>
    </div>
  )
}

type SortKey = 'name' | 'price' | 'change_pct' | 'ai_score'
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Index' },
  { key: 'price', label: 'Level' },
  { key: 'change_pct', label: 'Chg%' },
  { key: 'ai_score', label: 'AI Score' },
]

function RankRow({ row, rank }: { row: InternationalMarketRow; rank: number }) {
  return (
    <tr style={{ borderBottom: '1px solid #24324d' }}>
      <td className="px-2 py-2 text-center">{RANK_MEDALS[rank] ?? rank + 1}</td>
      <td className="px-2 py-2 text-left">
        <span className="font-medium">{row.name}</span>
        <span className="ml-1 text-[10px]" style={{ color: '#64748b' }}>{row.region}</span>
      </td>
      <td className="px-2 py-2 text-center">{fmtLevel(row.price)}</td>
      <td className="px-2 py-2 text-center"><PctChange pct={row.change_pct} /></td>
      <td className="px-2 py-2 text-center font-semibold">{row.ai_score}</td>
      <td className="px-2 py-2 text-center font-bold" style={{ color: TREND_COLOR[row.trend] }}>
        {TREND_ARROW[row.trend]} {row.trend}
      </td>
      <td className="px-2 py-2 text-center">{row.confidence_pct}%</td>
    </tr>
  )
}

export default function InternationalMarketView() {
  const [data, setData] = useState<{ generated_at: string; period: string; method: string } | null>(null)
  const [ranked, setRanked] = useState<InternationalMarketRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>('ai_score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const tokenRef = useRef('')

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getInternationalMarketDashboard(token)
      setData({ generated_at: res.generated_at, period: res.period, method: res.method })
      setRanked(res.ranked)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load International Market dashboard')
      setRanked(prev => prev ?? [])
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const rows = useMemo(() => ranked ?? [], [ranked])
  const withRank = useMemo(() => rows.map((row, i) => ({ row, rank: i })), [rows])

  const sortedRows = useMemo(() => {
    if (!sortKey) return withRank
    // Sort directly according to sortDir rather than sorting ascending and
    // reversing -- reversing after a stable sort also flips the tie-break
    // order, which visibly scrambles the Rank column whenever many rows
    // share the same ai_score (a common case here, since the score is a
    // coarse heuristic that saturates for strong moves).
    const dir = sortDir === 'asc' ? 1 : -1
    return [...withRank].sort((a, b) => {
      if (sortKey === 'name') return dir * a.row.name.localeCompare(b.row.name)
      const av = a.row[sortKey] ?? -Infinity
      const bv = b.row[sortKey] ?? -Infinity
      return dir * (av - bv)
    })
  }, [withRank, sortKey, sortDir])

  return (
    <div className="min-h-screen" style={{ background: '#0b1220', color: '#eef2ff' }}>
      <NavBar active="International Market" />

      <div
        className="px-4 py-4 text-center text-xl font-bold sm:text-2xl"
        style={{ background: 'linear-gradient(90deg,#2563eb,#7c3aed,#06b6d4)' }}
      >
        🌐 International Market
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm" style={{ color: '#cbd5e1' }}>
            Major global market indices (US, Europe, Asia &amp; Australia), ranked by AI Score. Trend/AI
            Score/Confidence are derived from the same local heuristic (EMA slope + ROC momentum + ATR conviction)
            used elsewhere in this app on the daily timeframe &mdash; not a trained model, and not the fuller
            technicals+news AI Score MCX&apos;s own dashboard computes. Index levels are shown in each index&apos;s
            own native units, not a single currency.
          </p>
          {data && (
            <div className="text-right text-xs" style={{ color: '#64748b' }}>
              <p>Refreshes every {POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)}</p>
              <p>Period: {data.period}</p>
            </div>
          )}
        </div>

        {err && (
          <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>
            {err}
          </div>
        )}

        {ranked === null && !err ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl px-4 py-10 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
            No scored indices yet &mdash; check back shortly.
          </div>
        ) : (
          <>
            <h2 className="mb-3 text-base font-bold">🔥 AI Heat Map (Ranked by AI Score)</h2>
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {rows
                .slice()
                .sort((a, b) => b.ai_score - a.ai_score)
                .map((row, i) => <HeatTile key={row.code} row={row} rank={i} />)}
            </div>

            <h2 className="mb-3 text-base font-bold">📊 Ranked International Market Dashboard</h2>
            <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: '#1e3a8a' }}>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Rank</th>
                    {SORT_COLUMNS.map(({ key, label }) => (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className="cursor-pointer select-none whitespace-nowrap px-2 py-2 text-center font-semibold hover:opacity-80"
                      >
                        {label}
                        <span className="ml-1 inline-block w-2.5 text-[9px]" style={{ opacity: sortKey === key ? 1 : 0.35 }}>
                          {sortKey === key && sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Trend</th>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(({ row, rank }) => <RankRow key={row.code} row={row} rank={rank} />)}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs" style={{ color: '#64748b' }}>
              AI Score/Trend/Confidence are a simple heuristic derivation, refreshed on each dashboard load from
              the already-cached daily candles &mdash; not a persisted/tracked score like MCX&apos;s AI Strength.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

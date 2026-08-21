'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getStrategyDashboard, getStrategyDashboardSignals } from '@/lib/api'
import type { StrategyDashboard, StrategyDashboardRow, StrategyDashboardSignal, StrategyDashboardSignalsResponse } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const DASHBOARD_CACHE_KEY = 'mcx-strategy-dashboard:data'
const SIGNALS_CACHE_KEY = 'mcx-strategy-dashboard:signals'
const POLL_MS = 30_000
const SIGNALS_POLL_MS = 60_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Same rank-shading convention as My Trading Dashboard's heat map.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f']
const VERDICT_COLOR: Record<string, string> = {
  STRONG: '#22c55e', TRADE: '#4ade80', WATCH: '#facc15', NO_TRADE: '#64748b',
}
const DIRECTION_COLOR: Record<string, string> = { BUY: '#22c55e', SELL: '#ef4444' }

function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

function fmtPrice(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function PctChange({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: '#64748b' }}>—</span>
  const pos = pct >= 0
  return <span style={{ color: pos ? '#22c55e' : '#ef4444' }}>{pos ? '+' : ''}{pct.toFixed(2)}%</span>
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// Deep-links into each contract's own dedicated Strategy panel (built
// earlier this session) rather than duplicating chart/reasoning UI here.
function panelHref(contract: string): string {
  if (contract === 'GOLDGUINEA') return '/mcx/metals/goldguinea'
  if (contract === 'SILVER100') return '/mcx/metals/silver100'
  return '/mcx/ngmini'
}

function HeatTile({ row, rank }: { row: StrategyDashboardRow; rank: number }) {
  return (
    <a
      href={panelHref(row.contract)}
      title={`Open ${row.name} strategy panel`}
      className="block rounded-2xl p-4 text-center font-bold no-underline shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
      style={{ background: row.available ? tileColor(rank) : '#334155', color: '#eef2ff' }}
    >
      <div className="text-lg">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</div>
      <div className="mt-1 text-2xl">{row.icon}</div>
      <p className="mt-1 truncate text-xs">{row.name}</p>
      {row.available ? (
        <>
          <p className="mt-1 text-xl font-extrabold">{((row.score_pct ?? 0) / 10).toFixed(1)}/10</p>
          <p className="mt-1 text-xs" style={{ color: DIRECTION_COLOR[row.direction ?? ''] }}>
            {row.verdict} &middot; {row.direction}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs" style={{ color: '#94a3b8' }}>Not enough history yet</p>
      )}
    </a>
  )
}

function RankRow({ row, rank }: { row: StrategyDashboardRow; rank: number }) {
  return (
    <tr style={{ borderBottom: '1px solid #24324d' }}>
      <td className="px-2 py-2 text-center">{RANK_MEDALS[rank] ?? rank + 1}</td>
      <td className="px-2 py-2 text-center">
        <span className="mr-1">{row.icon}</span>{row.name}
        <a
          href={panelHref(row.contract)}
          className="ml-1.5 inline-block rounded px-1 text-[10px] font-semibold no-underline"
          style={{ background: 'rgba(99,102,241,0.25)', color: '#c7d2fe' }}
        >
          Open →
        </a>
      </td>
      <td className="px-2 py-2 text-center">{fmtPrice(row.ltp)}</td>
      <td className="px-2 py-2 text-center"><PctChange pct={row.change_pct} /></td>
      {row.available ? (
        <>
          <td className="px-2 py-2 text-center font-semibold">{row.score_pct?.toFixed(1)}%</td>
          <td className="px-2 py-2 text-center font-bold" style={{ color: VERDICT_COLOR[row.verdict ?? ''] }}>{row.verdict}</td>
          <td className="px-2 py-2 text-center font-bold" style={{ color: DIRECTION_COLOR[row.direction ?? ''] }}>{row.direction}</td>
          <td className="px-2 py-2 text-center font-mono">{fmtPrice(row.entry_price)}</td>
          <td className="px-2 py-2 text-center font-mono" style={{ color: '#fca5a5' }}>{fmtPrice(row.stop_loss)}</td>
          <td className="px-2 py-2 text-center font-mono" style={{ color: '#86efac' }}>{fmtPrice(row.target_1)}</td>
          <td className="px-2 py-2 text-center">{row.risk_reward !== null ? `1:${row.risk_reward}` : '—'}</td>
        </>
      ) : (
        <td colSpan={7} className="px-2 py-2 text-center text-xs" style={{ color: '#64748b' }}>
          Not enough candle history yet — check back once more of the trading day has passed.
        </td>
      )}
    </tr>
  )
}

function fmtSignalDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}

function istDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function isSignalFromToday(iso: string): boolean {
  return istDateKey(iso) === istDateKey(new Date().toISOString())
}

const RESULT_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  WIN: { bg: '#065f46', fg: '#4ade80', label: 'WIN' },
  LOSS: { bg: '#450a0a', fg: '#fca5a5', label: 'LOSS' },
  EXPIRED: { bg: '#3f3f46', fg: '#a1a1aa', label: 'EXPIRED' },
  OPEN: { bg: '#1e3a8a', fg: '#93c5fd', label: 'OPEN' },
}

function ResultBadge({ result, status }: { result: string | null; status: string }) {
  const b = RESULT_BADGE[status === 'OPEN' ? 'OPEN' : (result ?? 'OPEN')]
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: b.bg, color: b.fg }}>
      {b.label}
    </span>
  )
}

function TargetCell({ t1, t2 }: { t1: number; t2: number | null }) {
  return (
    <span className="font-mono">
      {fmtPrice(t1)}
      {t2 !== null && <span style={{ color: '#64748b' }}> / {fmtPrice(t2)}</span>}
    </span>
  )
}

function CollapsibleSection({ title, count, defaultOpen, children }: {
  title: string
  count: number
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-8">
      <button
        onClick={() => setOpen(o => !o)}
        className="mb-3 flex w-full items-center gap-2 text-left text-base font-bold"
      >
        <span className="inline-block w-3 text-xs" style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span>
        {title}
        <span className="text-xs font-normal" style={{ color: '#64748b' }}>({count})</span>
      </button>
      {open && children}
    </div>
  )
}

const SIGNALS_TABLE_HEADERS = ['Contract', 'Generated', 'Direction', 'Entry', 'Target', 'Result']

function SignalsTable({ signals }: { signals: StrategyDashboardSignal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: '#1e3a8a' }}>
            {SIGNALS_TABLE_HEADERS.map(h => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map((s, i) => (
            <tr key={i} className="border-t" style={{ borderColor: '#1e293b' }}>
              <td className="whitespace-nowrap px-3 py-2.5">{s.icon} {s.name}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono" style={{ color: '#94a3b8' }}>
                {fmtSignalDateTime(s.generated_at)}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className="rounded px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: s.direction === 'BUY' ? '#065f46' : '#450a0a', color: s.direction === 'BUY' ? '#4ade80' : '#fca5a5' }}
                >
                  {s.direction}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono">{fmtPrice(s.entry_price)}</td>
              <td className="px-3 py-2.5"><TargetCell t1={s.target_1} t2={s.target_2} /></td>
              <td className="px-3 py-2.5"><ResultBadge result={s.result} status={s.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AllSignalsTab() {
  const [data, setData] = useState<StrategyDashboardSignalsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    const cached = readPageCache<StrategyDashboardSignalsResponse>(SIGNALS_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setData(cached))
    function load() {
      getStrategyDashboardSignals(t, 200)
        .then(r => { setData(r); writePageCache(SIGNALS_CACHE_KEY, r); setErr(null) })
        .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load signals'))
    }
    load()
    const id = setInterval(load, SIGNALS_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const signals = data?.signals ?? []
  const today = useMemo(() => signals.filter(s => isSignalFromToday(s.generated_at)), [signals])
  const history = useMemo(() => signals.filter(s => !isSignalFromToday(s.generated_at)), [signals])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm" style={{ color: '#cbd5e1' }}>
          Every signal logged by the Gold Guinea, Silver100, and NG Mini MTS Strategy engines, combined.
        </p>
        {data && (
          <p className="text-right text-xs" style={{ color: '#64748b' }}>
            Refreshes every {SIGNALS_POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)} &middot; {today.length} today, {history.length} history
          </p>
        )}
      </div>

      {err && <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</div>}

      {data && (
        <div className="mb-6 grid grid-cols-3 gap-3 text-center text-xs">
          {(['GOLDGUINEA', 'SILVER100', 'NGMINI'] as const).map(c => {
            const a = data.accuracy[c]
            const label = c === 'GOLDGUINEA' ? '🥇 Gold Guinea' : c === 'SILVER100' ? '🥈 Silver100' : '⛽ NG Mini'
            return (
              <div key={c} className="rounded-xl px-3 py-2.5" style={{ background: '#141d33' }}>
                <p className="font-semibold">{label}</p>
                <p className="mt-1" style={{ color: '#94a3b8' }}>
                  {a.accuracy_pct !== null ? `${a.accuracy_pct}% (${a.wins}/${a.resolved})` : 'No resolved signals yet'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {data === null && !err ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : signals.length === 0 ? (
        <div className="rounded-xl px-4 py-10 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
          No signals yet — a row is logged automatically whenever a strategy score hits TRADE or STRONG.
        </div>
      ) : (
        <>
          <CollapsibleSection title="🟢 Today's Calls" count={today.length} defaultOpen={true}>
            {today.length === 0 ? (
              <div className="rounded-xl px-4 py-8 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
                No signals generated yet today.
              </div>
            ) : <SignalsTable signals={today} />}
          </CollapsibleSection>
          <CollapsibleSection title="🕘 History Calls" count={history.length} defaultOpen={false}>
            {history.length === 0 ? (
              <div className="rounded-xl px-4 py-8 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
                No earlier signals yet.
              </div>
            ) : <SignalsTable signals={history} />}
          </CollapsibleSection>
        </>
      )}
    </>
  )
}

type MainTab = 'heatmap' | 'signals'
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'heatmap', label: 'Strategy Heat Map' },
  { id: 'signals', label: 'All Strategy Signals' },
]

export default function McxStrategyDashboardView() {
  const [tab, setTab] = useState<MainTab>('heatmap')
  const [data, setData] = useState<StrategyDashboard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getStrategyDashboard(token)
      setData(res)
      writePageCache(DASHBOARD_CACHE_KEY, res)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load Strategy Dashboard')
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    const cached = readPageCache<StrategyDashboard>(DASHBOARD_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setData(cached))
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const ranked = useMemo(() => data?.ranked ?? [], [data])

  return (
    <div className="min-h-screen" style={{ background: '#0b1220', color: '#eef2ff' }}>
      <NavBar active="MTS Strategy Dashboard" />

      <div
        className="px-4 py-4 text-center text-xl font-bold sm:text-2xl"
        style={{ background: 'linear-gradient(90deg,#f59e0b,#a855f7,#06b6d4)' }}
      >
        🥇 MTS Strategy Dashboard — Gold Guinea, Silver100 &amp; NG Mini
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center gap-1">
          {MAIN_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors"
              style={tab === t.id ? { background: '#4f46e5', color: '#fff' } : { background: '#1e293b', color: '#94a3b8' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'signals' && <AllSignalsTab />}

        {tab === 'heatmap' && (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <p className="text-sm" style={{ color: '#cbd5e1' }}>
                The three MTS Strategy engines (multi-timeframe 1H/15M/5M scorer), ranked together, scored live.
              </p>
              {data && (
                <p className="text-right text-xs" style={{ color: '#64748b' }}>
                  Refreshes every {POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)}
                </p>
              )}
            </div>

            {err && <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</div>}

            {data === null && !err ? (
              <div className="flex justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              </div>
            ) : (
              <>
                <h2 className="mb-3 text-base font-bold">🔥 Strategy Heat Map</h2>
                <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ranked.map((row, i) => <HeatTile key={row.contract} row={row} rank={i} />)}
                </div>

                <h2 className="mb-1 text-base font-bold">📊 Ranked Strategy Table</h2>
                <p className="mb-3 text-xs" style={{ color: '#64748b' }}>
                  Best-scoring direction (BUY or SELL) shown per contract. Click &ldquo;Open →&rdquo; for the full
                  panel — reasoning breakdown, chart, risk status, and signal history.
                </p>
                <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#1e3a8a' }}>
                        {['Rank', 'Contract', 'LTP', 'Chg%', 'Score', 'Verdict', 'Direction', 'Entry', 'Stop Loss', 'Target', 'R:R'].map(h => (
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
                  Score/Verdict/Entry/Stop Loss/Target come from each contract&apos;s own MTS Strategy engine
                  (1H trend gate + VWAP/EMA/RSI/pullback/reversal/volume/PDH-PDL/5M confirmation), recomputed live
                  on every load — see the{' '}
                  <a href="/mcx/correlation" className="font-medium text-indigo-400 hover:underline">MCX Correlation</a>{' '}
                  page for how these three move relative to each other.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

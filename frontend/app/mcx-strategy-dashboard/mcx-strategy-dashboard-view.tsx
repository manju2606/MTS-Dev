'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getStrategyDashboard, getStrategyDashboardLevels, getStrategyDashboardPerformance, getStrategyDashboardSignals } from '@/lib/api'
import type { StrategyDashboard, StrategyDashboardLevels, StrategyDashboardLevelsRow, StrategyDashboardPerformance, StrategyDashboardPerformanceRow, StrategyDashboardRow, StrategyDashboardSignal, StrategyDashboardSignalsResponse } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const DASHBOARD_CACHE_KEY = 'mcx-strategy-dashboard:data'
const SIGNALS_CACHE_KEY = 'mcx-strategy-dashboard:signals'
const PERFORMANCE_CACHE_KEY = 'mcx-strategy-dashboard:performance'
const LEVELS_CACHE_KEY = 'mcx-strategy-dashboard:levels'
const ALERTS_ENABLED_KEY = 'mcx-strategy-dashboard:alerts-enabled'
const POLL_MS = 30_000
const SIGNALS_POLL_MS = 60_000
const PERFORMANCE_POLL_MS = 120_000
const LEVELS_POLL_MS = 30_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Web Audio beep (no external asset needed) -- two quick blips, pitched
// higher for BUY and lower for SELL so the alert is distinguishable by ear
// without looking at the screen. Falls back silently if Web Audio is
// unavailable/blocked -- the browser notification still shows either way.
function playAlertSound(bull: boolean) {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor()
    const freq = bull ? 880 : 440
    const beep = (startOffset: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = ctx.currentTime + startOffset
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.25)
    }
    beep(0)
    beep(0.28)
    setTimeout(() => { ctx.close().catch(() => {}) }, 700)
  } catch {
    // Web Audio unavailable/blocked -- the browser notification still shows.
  }
}

function showBrowserNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body })
  } catch {
    // Some browsers throw for Notification() outside a service worker on
    // certain platforms (e.g. Android Chrome) -- sound + in-app state
    // still convey the alert.
  }
}

// Same rank-shading convention as My Trading Dashboard's heat map.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f']
const SIGNAL_LABEL_COLOR: Record<string, string> = {
  'STRONG BUY': '#22c55e', 'BUY': '#4ade80',
  'STRONG SELL': '#ef4444', 'SELL': '#f87171',
  'WATCH': '#facc15', 'NO TRADE': '#64748b',
}

function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

function isTradeable(row: StrategyDashboardRow): boolean {
  return row.verdict === 'TRADE' || row.verdict === 'STRONG'
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
          <p className="mt-1 text-xs" style={{ color: SIGNAL_LABEL_COLOR[row.signal_label ?? ''] }}>
            {row.signal_label}
          </p>
          {isTradeable(row) && row.can_trade === false && (
            <p className="mt-1 text-[10px] font-semibold" style={{ color: '#fbbf24' }} title={row.blocked_reasons.join(' · ')}>
              🚫 Alerts blocked
            </p>
          )}
          <p className="mt-1 text-[10px] font-normal" style={{ color: '#94a3b8' }}>{fmtSignalDateTime(row.updated_at)}</p>
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
          <td className="px-2 py-2 text-center font-bold" style={{ color: SIGNAL_LABEL_COLOR[row.signal_label ?? ''] }}>
            {row.signal_label}
            {isTradeable(row) && row.can_trade === false && (
              <div className="mt-0.5 text-[9px] font-normal" style={{ color: '#fbbf24' }} title={row.blocked_reasons.join(' · ')}>
                🚫 blocked
              </div>
            )}
          </td>
          <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-[11px]" style={{ color: '#94a3b8' }}>{fmtSignalDateTime(row.updated_at)}</td>
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
                  className="whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: s.direction === 'BUY' ? '#065f46' : '#450a0a', color: s.direction === 'BUY' ? '#4ade80' : '#fca5a5' }}
                >
                  {s.verdict === 'STRONG' ? `STRONG ${s.direction}` : s.direction}
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

function fmtCurrency(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

const PERFORMANCE_HEADERS = [
  'Contract', 'Trades', 'Win Rate', 'Net P&L', 'Profit Factor', 'Expectancy/Trade',
  'Max Drawdown', 'Sharpe', 'Recovery Factor', 'Avg Hold', 'Long / Short Win Rate',
]

function PerformanceRow({ row }: { row: StrategyDashboardPerformanceRow }) {
  return (
    <tr className="border-t" style={{ borderColor: '#1e293b' }}>
      <td className="whitespace-nowrap px-3 py-2.5">{row.icon} {row.name}</td>
      <td className="px-3 py-2.5 text-center">{row.total_trades}</td>
      <td className="px-3 py-2.5 text-center font-semibold" style={{ color: row.win_rate_pct >= 50 ? '#4ade80' : '#fca5a5' }}>
        {row.total_trades > 0 ? `${row.win_rate_pct}%` : '—'}
      </td>
      <td className="px-3 py-2.5 text-center font-mono font-semibold" style={{ color: row.net_pnl >= 0 ? '#4ade80' : '#f87171' }}>
        {row.total_trades > 0 ? fmtCurrency(row.net_pnl) : '—'}
      </td>
      <td className="px-3 py-2.5 text-center font-mono">{row.total_trades > 0 ? row.profit_factor : '—'}</td>
      <td className="px-3 py-2.5 text-center font-mono">{row.total_trades > 0 ? fmtCurrency(row.expectancy) : '—'}</td>
      <td className="px-3 py-2.5 text-center font-mono" style={{ color: '#fca5a5' }}>
        {row.total_trades > 0 ? `${row.max_drawdown_pct}%` : '—'}
      </td>
      <td className="px-3 py-2.5 text-center font-mono">{row.total_trades > 0 ? row.sharpe_ratio : '—'}</td>
      <td className="px-3 py-2.5 text-center font-mono">{row.total_trades > 0 ? row.recovery_factor : '—'}</td>
      <td className="px-3 py-2.5 text-center">{row.total_trades > 0 ? `${row.avg_holding_hours}h` : '—'}</td>
      <td className="px-3 py-2.5 text-center text-[11px]" style={{ color: '#94a3b8' }}>
        {row.long_trades > 0 || row.short_trades > 0
          ? `${row.long_trades} @ ${row.long_win_rate_pct}% / ${row.short_trades} @ ${row.short_win_rate_pct}%`
          : '—'}
      </td>
    </tr>
  )
}

function PerformanceTab() {
  const [data, setData] = useState<StrategyDashboardPerformance | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    const cached = readPageCache<StrategyDashboardPerformance>(PERFORMANCE_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setData(cached))
    function load() {
      getStrategyDashboardPerformance(t)
        .then(r => { setData(r); writePageCache(PERFORMANCE_CACHE_KEY, r); setErr(null) })
        .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load performance'))
    }
    load()
    const id = setInterval(load, PERFORMANCE_POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm" style={{ color: '#cbd5e1' }}>
          Real backtest performance per contract, computed from each strategy&apos;s own actually closed signals —
          not a synthetic re-simulation.
        </p>
        {data && (
          <p className="text-right text-xs" style={{ color: '#64748b' }}>
            Capital assumption ₹{data.capital.toLocaleString('en-IN')} &middot; updated {timeAgo(data.generated_at)}
          </p>
        )}
      </div>

      {err && <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</div>}

      {data === null && !err ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#1e3a8a' }}>
                {PERFORMANCE_HEADERS.map(h => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-center font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map(row => <PerformanceRow key={row.contract} row={row} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: '#64748b' }}>
        A contract with 0 trades has no closed signals yet — win rate/P&amp;L/etc. need at least one closed
        (WIN/LOSS/EXPIRED) signal to compute. Long/Short splits show trade count @ win rate for each direction.
      </p>
    </>
  )
}

function fmtNum(v: number | null, maximumFractionDigits = 0): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits })
}

const LEVELS_HEADERS = [
  'Contract', 'LTP', 'Open', 'Prev Close', 'Chg%', 'Day High/Low', 'Week High/Low',
  'Month High/Low', 'Volume', 'OI', 'Pivot', 'R1 / S1', 'R2 / S2',
]

function LevelsRow({ row }: { row: StrategyDashboardLevelsRow }) {
  return (
    <tr className="border-t" style={{ borderColor: '#1e293b' }}>
      <td className="whitespace-nowrap px-3 py-2.5">{row.icon} {row.name}</td>
      <td className="px-3 py-2.5 text-center font-mono font-semibold">{fmtPrice(row.ltp)}</td>
      <td className="px-3 py-2.5 text-center font-mono">{fmtPrice(row.open)}</td>
      <td className="px-3 py-2.5 text-center font-mono">{fmtPrice(row.prev_close)}</td>
      <td className="px-3 py-2.5 text-center"><PctChange pct={row.change_pct} /></td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px]">
        <span style={{ color: '#86efac' }}>{fmtPrice(row.day_high)}</span>
        {' / '}
        <span style={{ color: '#fca5a5' }}>{fmtPrice(row.day_low)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px]">
        <span style={{ color: '#86efac' }}>{fmtPrice(row.week_high)}</span>
        {' / '}
        <span style={{ color: '#fca5a5' }}>{fmtPrice(row.week_low)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px]">
        <span style={{ color: '#86efac' }}>{fmtPrice(row.month_high)}</span>
        {' / '}
        <span style={{ color: '#fca5a5' }}>{fmtPrice(row.month_low)}</span>
      </td>
      <td className="px-3 py-2.5 text-center font-mono">{fmtNum(row.volume)}</td>
      <td className="px-3 py-2.5 text-center font-mono">{fmtNum(row.oi)}</td>
      <td className="px-3 py-2.5 text-center font-mono">{row.pivot !== null ? fmtPrice(row.pivot) : <span style={{ color: '#64748b' }}>—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px]">
        {row.r1 !== null ? (
          <>
            <span style={{ color: '#fca5a5' }}>{fmtPrice(row.r1)}</span>
            {' / '}
            <span style={{ color: '#86efac' }}>{fmtPrice(row.s1)}</span>
          </>
        ) : <span style={{ color: '#64748b' }}>—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px]">
        {row.r2 !== null ? (
          <>
            <span style={{ color: '#fca5a5' }}>{fmtPrice(row.r2)}</span>
            {' / '}
            <span style={{ color: '#86efac' }}>{fmtPrice(row.s2)}</span>
          </>
        ) : <span style={{ color: '#64748b' }}>—</span>}
      </td>
    </tr>
  )
}

function LevelsTab() {
  const [data, setData] = useState<StrategyDashboardLevels | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    const cached = readPageCache<StrategyDashboardLevels>(LEVELS_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setData(cached))
    function load() {
      getStrategyDashboardLevels(t)
        .then(r => { setData(r); writePageCache(LEVELS_CACHE_KEY, r); setErr(null) })
        .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load technical levels'))
    }
    load()
    const id = setInterval(load, LEVELS_POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm" style={{ color: '#cbd5e1' }}>
          Live LTP, OHLC, volume, open interest, and day/week/month range for Gold Guinea, Silver100, and NG Mini,
          plus classic floor-trader pivot/support/resistance where available (NG Mini only, for now).
        </p>
        {data && (
          <p className="text-right text-xs" style={{ color: '#64748b' }}>
            Refreshes every {LEVELS_POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)}
          </p>
        )}
      </div>

      {err && <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>{err}</div>}

      {data === null && !err ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#1e3a8a' }}>
                {LEVELS_HEADERS.map(h => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-center font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map(row => <LevelsRow key={row.contract} row={row} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: '#64748b' }}>
        Pivot/R1-R2/S1-S2 are classic 5-point floor-trader levels off the last completed daily candle. Week starts
        Monday, month starts the 1st — both roll in today&apos;s session as it happens, not just after close.
      </p>
    </>
  )
}

type MainTab = 'heatmap' | 'levels' | 'signals' | 'performance'
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'heatmap', label: 'Strategy Heat Map' },
  { id: 'levels', label: 'Technical Levels' },
  { id: 'signals', label: 'All Strategy Signals' },
  { id: 'performance', label: 'Performance' },
]

export default function McxStrategyDashboardView() {
  const [tab, setTab] = useState<MainTab>('heatmap')
  const [data, setData] = useState<StrategyDashboard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const tokenRef = useRef('')
  const alertsEnabledRef = useRef(false)
  // Last-seen signal_label per contract -- an alert fires only when this
  // changes into a tradeable state (TRADE/STRONG), not on every poll while
  // the same signal is still open, and not on the very first load (that
  // would alert on every signal already showing when the tab was opened).
  const prevSignalRef = useRef<Record<string, string | null>>({})
  const firstLoadRef = useRef(true)

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getStrategyDashboard(token)
      setData(res)
      writePageCache(DASHBOARD_CACHE_KEY, res)
      setErr(null)

      if (alertsEnabledRef.current && !firstLoadRef.current) {
        for (const row of res.ranked) {
          // can_trade === false means the same risk gate the background
          // scheduler job checks is already blocking a new signal for this
          // contract (daily trade cap, consecutive-loss pause, expiry
          // protection) -- no email/in-app alert will fire for it either,
          // so skip the client-side sound/notification too rather than
          // alerting on something that isn't actually actionable.
          const tradeable = row.available && isTradeable(row) && row.can_trade !== false
          if (tradeable && row.signal_label !== prevSignalRef.current[row.contract]) {
            playAlertSound(row.direction === 'BUY')
            showBrowserNotification(
              `${row.icon} ${row.name}: ${row.signal_label}`,
              `Entry ${fmtPrice(row.entry_price)} · SL ${fmtPrice(row.stop_loss)} · Target ${fmtPrice(row.target_1)}`,
            )
          }
        }
      }
      firstLoadRef.current = false
      const next: Record<string, string | null> = {}
      for (const row of res.ranked) next[row.contract] = row.available ? row.signal_label : null
      prevSignalRef.current = next
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load Strategy Dashboard')
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    const enabled = localStorage.getItem(ALERTS_ENABLED_KEY) === '1'
      && typeof Notification !== 'undefined' && Notification.permission === 'granted'
    setAlertsEnabled(enabled)
    alertsEnabledRef.current = enabled
    const cached = readPageCache<StrategyDashboard>(DASHBOARD_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setData(cached))
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  function toggleAlerts() {
    if (alertsEnabled) {
      setAlertsEnabled(false)
      alertsEnabledRef.current = false
      localStorage.setItem(ALERTS_ENABLED_KEY, '0')
      return
    }
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(perm => {
      const on = perm === 'granted'
      setAlertsEnabled(on)
      alertsEnabledRef.current = on
      localStorage.setItem(ALERTS_ENABLED_KEY, on ? '1' : '0')
    })
  }

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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
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
          <button
            onClick={toggleAlerts}
            title={alertsEnabled ? 'Disable sound + browser alerts on new BUY/SELL signals' : 'Enable sound + browser alerts on new BUY/SELL signals'}
            className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors"
            style={alertsEnabled ? { background: '#065f46', color: '#4ade80' } : { background: '#1e293b', color: '#94a3b8' }}
          >
            {alertsEnabled ? '🔔 Alerts On' : '🔕 Enable Alerts'}
          </button>
        </div>

        {tab === 'signals' && <AllSignalsTab />}
        {tab === 'performance' && <PerformanceTab />}
        {tab === 'levels' && <LevelsTab />}

        {tab === 'heatmap' && (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <p className="text-sm" style={{ color: '#cbd5e1' }}>
                The three MTS Strategy engines (multi-timeframe 1H/15M/5M scorer), ranked together, scored live.
                A high-priority email goes out automatically to your account whenever any of the three logs a new
                BUY/SELL signal in the background &mdash; &ldquo;Enable Alerts&rdquo; above adds a sound + browser
                notification too, while this tab is open.
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
                        {['Rank', 'Contract', 'LTP', 'Chg%', 'Score', 'Signal', 'Generated', 'Entry', 'Stop Loss', 'Target', 'R:R'].map(h => (
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
                  page for how these three move relative to each other. A &ldquo;🚫 Alerts blocked&rdquo; note under a
                  BUY/SELL signal means the same daily risk gate the background job checks (max trades/day,
                  consecutive-loss pause, or expiry protection) is already blocking that contract today — no
                  email/sound/notification will fire for it even though the live score still shows a signal.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

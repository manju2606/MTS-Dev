'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import {
  getSotDHistory, getSotDJournal, getSotDToday, triggerSotDGenerate,
} from '@/lib/api'
import type { SotDJournalEntry, StockOfDay } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  WATCHING:   { label: 'Watching',    color: 'text-amber-700',   bg: 'bg-amber-50 dark:bg-amber-950/30',  dot: 'bg-amber-400' },
  TRADING:    { label: 'Live Trade',  color: 'text-blue-700',    bg: 'bg-blue-50 dark:bg-blue-950/30',    dot: 'bg-blue-500 animate-pulse' },
  TARGET_HIT: { label: 'Target Hit',  color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500' },
  STOP_HIT:   { label: 'Stop Hit',    color: 'text-red-700',     bg: 'bg-red-50 dark:bg-red-950/30',      dot: 'bg-red-500' },
  EXPIRED:    { label: 'Expired',     color: 'text-zinc-500',    bg: 'bg-zinc-100 dark:bg-zinc-800',      dot: 'bg-zinc-400' },
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.WATCHING
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${m.color} ${m.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

function PnlChip({ pnl, outcome }: { pnl: number | null; outcome: string | null }) {
  if (pnl == null) return null
  const pos = pnl >= 0
  return (
    <span className={`text-sm font-bold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
      {pos ? '+' : ''}{pnl.toFixed(2)}%
      {outcome && <span className="ml-1 text-[10px] opacity-75">({outcome})</span>}
    </span>
  )
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 85 ? 'from-emerald-500 to-emerald-400'
    : score >= 70 ? 'from-indigo-500 to-indigo-400'
    : 'from-amber-500 to-amber-400'
  return (
    <div className="relative flex h-20 w-20 flex-col items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" className="dark:stroke-zinc-700" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke="url(#sg)" strokeWidth="3"
          strokeDasharray={`${score} ${100 - score}`}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" className={`${color.split(' ')[0]} stop-color`} />
            <stop offset="100%" className={`${color.split(' ')[1]} stop-color`} />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{Math.round(score)}</span>
      <span className="text-[9px] text-zinc-400">/ 100</span>
    </div>
  )
}

// ── Today's Pick card ─────────────────────────────────────────────────────────

function TodayCard({
  sotd, onGenerate, generating,
}: {
  sotd: StockOfDay | null
  onGenerate: () => void
  generating: boolean
}) {
  if (!sotd) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-2xl">⭐</p>
        <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          No pick yet for today
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Auto-generates at 09:30 IST on trading days · Or trigger manually below
        </p>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : '⚡ Generate Now'}
        </button>
      </div>
    )
  }

  const sym = sotd.symbol.replace(/\.(NS|BO)$/, '')
  const pctSl  = ((sotd.stop_loss  - sotd.entry_price) / sotd.entry_price * 100)
  const pctTgt = ((sotd.target     - sotd.entry_price) / sotd.entry_price * 100)

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-zinc-100 bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 dark:border-zinc-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-200">⭐ Stock of the Day · {sotd.date}</p>
          <h2 className="mt-0.5 text-2xl font-extrabold text-white">{sym}</h2>
          <p className="text-sm text-indigo-200">{sotd.name} &nbsp;·&nbsp; {sotd.sector}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={sotd.status} />
          {sotd.pnl_pct != null && (
            <PnlChip pnl={sotd.pnl_pct} outcome={sotd.outcome} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2">
        {/* Left: trade params */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Entry', value: `₹${fmt(sotd.entry_price)}`, color: 'text-zinc-900 dark:text-zinc-50' },
              { label: 'Stop Loss', value: `₹${fmt(sotd.stop_loss)}`, sub: `${pctSl.toFixed(1)}%`, color: 'text-red-600 dark:text-red-400' },
              { label: 'Target', value: `₹${fmt(sotd.target)}`, sub: `+${pctTgt.toFixed(1)}%`, color: 'text-emerald-600 dark:text-emerald-400' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
                <p className={`mt-1 text-sm font-bold font-mono ${color}`}>{value}</p>
                {sub && <p className={`text-[10px] ${color} opacity-75`}>{sub}</p>}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
            <div>
              <p className="text-[10px] text-zinc-400 uppercase">R:R Ratio</p>
              <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{sotd.risk_reward.toFixed(2)}x</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 uppercase">Hold</p>
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{sotd.holding_period}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 uppercase">Signal</p>
              <p className="text-sm font-bold text-indigo-600">{sotd.discovery_signal.replace('_', ' ')}</p>
            </div>
          </div>

          {sotd.scanner_hits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sotd.scanner_hits.map(h => (
                <span key={h} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                  {h.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}

          {/* Auto-trade badge */}
          {sotd.auto_traded ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/30">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">✅ Auto-Trade Active (Paper)</p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                Placed automatically · Score {sotd.composite_score}/100 ≥ 85 threshold · Qty {sotd.quantity}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                ⚠ Score {sotd.composite_score}/100 — below 85 auto-trade threshold
              </p>
              <p className="text-[10px] text-amber-600">Review manually via Forecast or Scanner</p>
            </div>
          )}
        </div>

        {/* Right: score gauge + explanation + links */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
            <ScoreGauge score={sotd.composite_score} />
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase">Composite Score</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">Discovery {Math.round(sotd.discovery_score)} + Scanner bonus + Signal bonus</p>
              <p className="mt-1 text-[10px] text-zinc-300 dark:text-zinc-600">≥85 triggers auto paper trade</p>
            </div>
          </div>

          <div className="flex-1 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-400">AI Explanation</p>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 line-clamp-6">
              {sotd.explanation}
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href={`/forecast?symbol=${sym}`}
              className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-center text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
            >
              📈 Forecast
            </Link>
            <Link
              href="/scanner"
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-center text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              🔍 Scanner
            </Link>
            <Link
              href="/paper-trading"
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-center text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              📋 Paper Trades
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Journal timeline ──────────────────────────────────────────────────────────

const EVENT_META: Record<string, { icon: string; color: string }> = {
  PICK_GENERATED: { icon: '⭐', color: 'text-indigo-600' },
  AUTO_TRADE:     { icon: '🤖', color: 'text-blue-600' },
  TARGET_HIT:     { icon: '🎯', color: 'text-emerald-600' },
  STOP_HIT:       { icon: '⛔', color: 'text-red-600' },
  EXPIRED:        { icon: '🔔', color: 'text-zinc-500' },
}

function JournalTimeline({ entries }: { entries: SotDJournalEntry[] }) {
  if (!entries.length) return (
    <p className="py-6 text-center text-xs text-zinc-400">No journal entries yet</p>
  )
  return (
    <div className="space-y-3">
      {entries.map(e => {
        const meta = EVENT_META[e.event] ?? { icon: '📝', color: 'text-zinc-500' }
        const d = e.details
        return (
          <div key={e._id} className="flex gap-3">
            <div className={`mt-0.5 w-6 text-center text-base shrink-0 ${meta.color}`}>{meta.icon}</div>
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{e.event.replace(/_/g, ' ')}</p>
                <p className="text-[10px] text-zinc-400">
                  {new Date(e.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {Object.entries(d).map(([k, v]) => (
                  <span key={k} className="text-[10px] text-zinc-500">
                    <span className="text-zinc-400">{k.replace(/_/g, ' ')}: </span>
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── History table ─────────────────────────────────────────────────────────────

function HistoryTable({ history }: { history: StockOfDay[] }) {
  if (!history.length) return (
    <p className="py-8 text-center text-sm text-zinc-400">No history yet — picks generate daily at 09:30 IST</p>
  )
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
            {['Date', 'Symbol', 'Sector', 'Score', 'Entry ₹', 'SL ₹', 'Target ₹', 'R:R', 'Status', 'Exit ₹', 'P&L'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map(row => {
            const sym = row.symbol.replace(/\.(NS|BO)$/, '')
            const pnl = row.pnl_pct
            const pnlColor = pnl == null ? '' : pnl >= 0 ? 'text-emerald-600' : 'text-red-500'
            return (
              <tr key={row.date + row.symbol} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
                <td className="px-3 py-2 text-zinc-400">{row.date}</td>
                <td className="px-3 py-2">
                  <Link href={`/forecast?symbol=${sym}`} className="font-bold text-zinc-800 hover:text-indigo-600 dark:text-zinc-200">
                    {sym}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-500">{row.sector}</td>
                <td className="px-3 py-2">
                  <span className={`font-bold ${row.composite_score >= 85 ? 'text-emerald-600' : 'text-indigo-500'}`}>
                    {Math.round(row.composite_score)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">₹{fmt(row.entry_price)}</td>
                <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">₹{fmt(row.stop_loss)}</td>
                <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">₹{fmt(row.target)}</td>
                <td className="px-3 py-2 font-semibold text-indigo-600">{row.risk_reward.toFixed(2)}x</td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-2 font-mono">{row.exit_price ? `₹${fmt(row.exit_price)}` : '—'}</td>
                <td className={`px-3 py-2 font-bold font-mono ${pnlColor}`}>
                  {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── P&L summary strip ─────────────────────────────────────────────────────────

function PnlSummary({ history }: { history: StockOfDay[] }) {
  const closed = history.filter(h => h.pnl_pct != null)
  if (!closed.length) return null

  const wins    = closed.filter(h => h.outcome === 'WIN').length
  const losses  = closed.filter(h => h.outcome === 'LOSS').length
  const avgPnl  = closed.reduce((s, h) => s + (h.pnl_pct ?? 0), 0) / closed.length
  const winRate = Math.round(wins / closed.length * 100)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: 'Picks Closed', value: String(closed.length), color: 'text-zinc-700 dark:text-zinc-200' },
        { label: 'Win Rate', value: `${winRate}%`, color: winRate >= 60 ? 'text-emerald-600' : 'text-amber-600' },
        { label: 'Wins / Losses', value: `${wins} / ${losses}`, color: 'text-zinc-600 dark:text-zinc-300' },
        { label: 'Avg P&L', value: `${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%`, color: avgPnl >= 0 ? 'text-emerald-600' : 'text-red-500' },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function StockOfDayView() {
  const [today, setToday] = useState<StockOfDay | null>(null)
  const [history, setHistory] = useState<StockOfDay[]>([])
  const [journal, setJournal] = useState<SotDJournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const token = localStorage.getItem('mts_token') ?? ''
    if (!token) return
    setLoading(true)
    try {
      const [todayRes, histRes] = await Promise.all([
        getSotDToday(token),
        getSotDHistory(token, 30),
      ])
      setToday(todayRes.data)
      setHistory(histRes)

      if (todayRes.data) {
        const j = await getSotDJournal(token, todayRes.today)
        setJournal(j)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    const token = localStorage.getItem('mts_token') ?? ''
    if (!token) return
    setGenerating(true)
    setError(null)
    try {
      const sotd = await triggerSotDGenerate(token)
      setToday(sotd)
      const j = await getSotDJournal(token, sotd.date)
      setJournal(j)
      setHistory(prev => [sotd, ...prev.filter(h => h.date !== sotd.date)])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Stock of Day" />
      <div className="mx-auto max-w-5xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Stock of the Day</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              AI-selected best pick from Discovery + Scanner · Auto paper trade when confidence ≥ 85 · SL and target auto-executed
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? '⏳ Generating…' : '⚡ Regenerate'}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="h-64 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="grid grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Today's pick */}
            <TodayCard sotd={today} onGenerate={handleGenerate} generating={generating} />

            {/* Journal for today */}
            {journal.length > 0 && (
              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Today's Activity Log</h3>
                <JournalTimeline entries={journal} />
              </div>
            )}

            {/* P&L summary */}
            <PnlSummary history={history} />

            {/* History */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Pick History &amp; P&amp;L Tracking
              </h3>
              <HistoryTable history={history} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

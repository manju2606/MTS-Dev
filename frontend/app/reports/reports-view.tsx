'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { listReportHistory, getReportDetail, getReportPerformance } from '@/lib/api'
import type { ReportSummary, ReportDetail, ReportPick, ReportPerformance, PerformancePick } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

const SIGNAL_STYLE: Record<string, string> = {
  STRONG_BUY:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  BUY:         'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  WATCH:       'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  NEUTRAL:     'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  SELL:        'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400',
  STRONG_SELL: 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-300',
}

function SignalBadge({ signal }: { signal: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLE[signal] ?? SIGNAL_STYLE.NEUTRAL}`}>
      {signal.replace('_', ' ')}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-indigo-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-zinc-500">{score.toFixed(0)}</span>
    </div>
  )
}

function SummaryPills({ summary }: { summary: Record<string, number> }) {
  const order = ['STRONG_BUY', 'BUY', 'WATCH', 'NEUTRAL', 'SELL', 'STRONG_SELL']
  return (
    <div className="flex flex-wrap gap-1">
      {order.map(sig => {
        const count = summary[sig]
        if (!count) return null
        return (
          <span key={sig} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SIGNAL_STYLE[sig]}`}>
            {count} {sig.replace('_', ' ')}
          </span>
        )
      })}
    </div>
  )
}

function PicksTable({ picks }: { picks: ReportPick[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {[
              { h: '#', cls: 'text-zinc-400' },
              { h: 'Symbol', cls: 'text-zinc-400' },
              { h: 'Signal', cls: 'text-zinc-400' },
              { h: 'Score', cls: 'text-zinc-400' },
              { h: 'Entry', cls: 'text-zinc-400' },
              { h: 'Stop', cls: 'text-zinc-400' },
              { h: 'T1', cls: 'text-emerald-600 dark:text-emerald-400' },
              { h: 'T2', cls: 'text-emerald-700 dark:text-emerald-500' },
              { h: 'T3', cls: 'text-emerald-800 dark:text-emerald-600' },
              { h: 'R:R', cls: 'text-zinc-400' },
              { h: 'Hold', cls: 'text-zinc-400' },
            ].map(({ h, cls }) => (
              <th key={h} className={`px-3 py-2 text-left text-xs font-medium ${cls}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picks.map((p, i) => {
            const allTargets = (p.targets && p.targets.length > 0)
              ? p.targets
              : p.target != null ? [p.target] : []
            const pct = (t: number) => `+${(((t - p.entry_price) / p.entry_price) * 100).toFixed(1)}%`
            const stopPct = p.entry_price > 0
              ? `${(((p.stop_loss - p.entry_price) / p.entry_price) * 100).toFixed(1)}%`
              : ''
            return (
              <tr key={p.symbol} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-zinc-50/50 dark:bg-zinc-800/20' : ''}`}>
                <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50">{p.symbol.replace(/\.(NS|BO)$/, '')}</p>
                  <p className="text-[10px] text-zinc-400">{p.name}</p>
                </td>
                <td className="px-3 py-2"><SignalBadge signal={p.signal} /></td>
                <td className="px-3 py-2"><ScoreBar score={p.score} /></td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  ₹{p.entry_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-red-500">
                  ₹{p.stop_loss.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  <span className="block text-[10px] text-zinc-400">{stopPct}</span>
                </td>
                {[0, 1, 2].map(ti => (
                  <td key={ti} className="px-3 py-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                    {allTargets[ti] != null ? (
                      <>
                        ₹{allTargets[ti].toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        <span className="block text-[10px] text-zinc-400">{pct(allTargets[ti])}</span>
                      </>
                    ) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {p.risk_reward_ratio.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">{p.holding_period}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Performance table ─────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  TARGET_HIT:   { label: 'Target Hit',   cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300' },
  STOP_HIT:     { label: 'Stop Hit',     cls: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300' },
  ABOVE_ENTRY:  { label: 'Above Entry',  cls: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  BELOW_ENTRY:  { label: 'Below Entry',  cls: 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400' },
  AT_ENTRY:     { label: 'At Entry',     cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  NO_DATA:      { label: 'No Data',      cls: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500' },
}

function PerformanceTable({ picks }: { picks: PerformancePick[] }) {
  const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
  const pct = (entry: number, t: number) => `+${(((t - entry) / entry) * 100).toFixed(1)}%`
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {[
              { h: '#', cls: 'text-zinc-400' },
              { h: 'Symbol', cls: 'text-zinc-400' },
              { h: 'Signal', cls: 'text-zinc-400' },
              { h: 'Entry', cls: 'text-zinc-400' },
              { h: 'Stop', cls: 'text-zinc-400' },
              { h: 'T1', cls: 'text-emerald-600 dark:text-emerald-400' },
              { h: 'T2', cls: 'text-emerald-700 dark:text-emerald-500' },
              { h: 'T3', cls: 'text-emerald-800 dark:text-emerald-600' },
              { h: 'Current', cls: 'text-zinc-400' },
              { h: 'P&L %', cls: 'text-zinc-400' },
              { h: 'Status', cls: 'text-zinc-400' },
            ].map(({ h, cls }) => (
              <th key={h} className={`px-3 py-2 text-left text-xs font-medium ${cls}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picks.map((p, i) => {
            const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.NO_DATA
            const allTargets = (p.targets && p.targets.length > 0)
              ? p.targets
              : p.target != null ? [p.target] : []
            const pnlColor = p.pnl_pct == null ? '' : p.pnl_pct >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-500 dark:text-red-400'
            return (
              <tr key={p.symbol} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-zinc-50/50 dark:bg-zinc-800/20' : ''}`}>
                <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50">{p.symbol.replace(/\.(NS|BO)$/, '')}</p>
                  <p className="text-[10px] text-zinc-400">{p.name}</p>
                </td>
                <td className="px-3 py-2"><SignalBadge signal={p.signal} /></td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">{fmt(p.entry_price)}</td>
                <td className="px-3 py-2 font-mono text-xs text-red-500">
                  {fmt(p.stop_loss)}
                  <span className="block text-[10px] text-zinc-400">
                    {p.entry_price > 0 ? `${(((p.stop_loss - p.entry_price) / p.entry_price) * 100).toFixed(1)}%` : ''}
                  </span>
                </td>
                {[0, 1, 2].map(ti => (
                  <td key={ti} className="px-3 py-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                    {allTargets[ti] != null ? (
                      <>
                        {fmt(allTargets[ti])}
                        <span className="block text-[10px] text-zinc-400">{pct(p.entry_price, allTargets[ti])}</span>
                      </>
                    ) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  {p.current_price != null ? fmt(p.current_price) : <span className="text-zinc-300">—</span>}
                </td>
                <td className={`px-3 py-2 font-mono text-xs font-bold ${pnlColor}`}>
                  {p.pnl_pct != null ? `${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(2)}%` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Report row (collapsible) ──────────────────────────────────────────────────

type ViewMode = 'picks' | 'performance'

function ReportRow({ report, tokenRef }: { report: ReportSummary; tokenRef: React.RefObject<string> }) {
  const [open, setOpen]           = useState(false)
  const [mode, setMode]           = useState<ViewMode>('picks')
  const [detail, setDetail]       = useState<ReportDetail | null>(null)
  const [perf, setPerf]           = useState<ReportPerformance | null>(null)
  const [loading, setLoading]     = useState(false)
  const [perfLoading, setPerfLoading] = useState(false)

  function toggle() {
    if (!open && !detail) {
      setLoading(true)
      getReportDetail(tokenRef.current, report.id)
        .then(d => { setDetail(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    setOpen(o => !o)
  }

  function analyse(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(true)
    setMode('performance')
    if (!perf) {
      setPerfLoading(true)
      getReportPerformance(tokenRef.current, report.id)
        .then(p => { setPerf(p); setPerfLoading(false) })
        .catch(() => setPerfLoading(false))
    }
  }

  const dt = new Date(report.generated_at)
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Summary row */}
      <div className="flex items-center justify-between px-5 py-4">
        <button onClick={toggle} className="flex flex-1 items-start gap-4 text-left">
          <div className="min-w-[90px]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{timeStr}</p>
            <p className="text-xs text-zinc-400">{dateStr}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
              {report.scanned_count} scanned
            </span>
            <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {report.picks_count} picks
            </span>
            <SummaryPills summary={report.signal_summary} />
          </div>
        </button>
        <div className="ml-4 flex items-center gap-2">
          <button
            onClick={analyse}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            Analyse
          </button>
          <button onClick={toggle} className="text-zinc-400">{open ? '▲' : '▼'}</button>
        </div>
      </div>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800">
          {/* Mode tabs */}
          <div className="flex border-b border-zinc-100 px-5 dark:border-zinc-800">
            {(['picks', 'performance'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); if (m === 'performance' && !perf) analyse({ stopPropagation: () => {} } as React.MouseEvent) }}
                className={`mr-4 border-b-2 py-2.5 text-xs font-semibold transition-colors ${
                  mode === m
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                {m === 'picks' ? 'Original Picks' : 'vs Current Price'}
              </button>
            ))}
          </div>

          {mode === 'picks' && (
            <>
              {loading && <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}
              {!loading && detail && <PicksTable picks={detail.picks} />}
              {!loading && !detail && <p className="px-5 py-4 text-sm text-zinc-400">Failed to load picks.</p>}
            </>
          )}

          {mode === 'performance' && (
            <>
              {perfLoading && <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}
              {!perfLoading && perf && <PerformanceTable picks={perf.picks} />}
              {!perfLoading && !perf && <p className="px-5 py-4 text-sm text-zinc-400">Failed to load performance data.</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function ReportsView() {
  const router   = useRouter()
  const tokenRef = useRef('')
  const [reports, setReports] = useState<ReportSummary[] | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    listReportHistory(t, 100)
      .then(r => setReports(r))
      .catch(() => setReports([]))
  }, [router])

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Reports" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Report History</h1>
            <p className="text-sm text-zinc-400">Every hourly scan that generated an email is saved here.</p>
          </div>
          {reports !== null && (
            <span className="rounded-lg bg-zinc-100 px-3 py-1 text-sm text-zinc-500 dark:bg-zinc-800">
              {reports.length} reports
            </span>
          )}
        </div>

        {/* Loading skeleton */}
        {reports === null && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {reports !== null && reports.length === 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-20 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">No reports yet.</p>
            <p className="mt-1 text-xs text-zinc-400">Reports are saved automatically after each hourly scan email.</p>
          </div>
        )}

        {/* Report list */}
        {reports !== null && reports.length > 0 && (
          <div className="space-y-3">
            {reports.map(r => (
              <ReportRow key={r.id} report={r} tokenRef={tokenRef} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

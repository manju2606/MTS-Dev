'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { listReportHistory, getReportDetail } from '@/lib/api'
import type { ReportSummary, ReportDetail, ReportPick } from '@/lib/api'
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
            {['#', 'Symbol', 'Signal', 'Score', 'Entry', 'Stop', 'T1', 'R:R', 'Hold'].map(h => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picks.map((p, i) => (
            <tr key={p.symbol} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-zinc-50/50 dark:bg-zinc-800/20' : ''}`}>
              <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
              <td className="px-3 py-2">
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {p.symbol.replace(/\.(NS|BO)$/, '')}
                </p>
                <p className="text-[10px] text-zinc-400">{p.name}</p>
              </td>
              <td className="px-3 py-2"><SignalBadge signal={p.signal} /></td>
              <td className="px-3 py-2"><ScoreBar score={p.score} /></td>
              <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                ₹{p.entry_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-red-500">
                ₹{p.stop_loss.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                {p.target ? `₹${p.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
              </td>
              <td className="px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {p.risk_reward_ratio.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500">{p.holding_period}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Report row (collapsible) ──────────────────────────────────────────────────

function ReportRow({ report, tokenRef }: { report: ReportSummary; tokenRef: React.RefObject<string> }) {
  const [open, setOpen]       = useState(false)
  const [detail, setDetail]   = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(false)

  function toggle() {
    if (!open && !detail) {
      setLoading(true)
      getReportDetail(tokenRef.current, report.id)
        .then(d => { setDetail(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    setOpen(o => !o)
  }

  const dt = new Date(report.generated_at)
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Summary row */}
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <div className="flex items-start gap-4">
          {/* Timestamp */}
          <div className="min-w-[90px]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{timeStr}</p>
            <p className="text-xs text-zinc-400">{dateStr}</p>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
              {report.scanned_count} scanned
            </span>
            <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {report.picks_count} picks
            </span>
            <SummaryPills summary={report.signal_summary} />
          </div>
        </div>

        <span className="ml-4 text-zinc-400">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded picks */}
      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            </div>
          )}
          {!loading && detail && <PicksTable picks={detail.picks} />}
          {!loading && !detail && (
            <p className="px-5 py-4 text-sm text-zinc-400">Failed to load picks.</p>
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

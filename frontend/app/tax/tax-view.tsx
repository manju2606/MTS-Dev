'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getTaxReport, exportTaxCsv } from '@/lib/api'
import type { TaxReport, TaxTrade } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const REPORT_CACHE_KEY_PREFIX = 'tax:report:'

const CURRENT_FY = (() => {
  const now = new Date()
  const y = now.getFullYear()
  const startYear = now.getMonth() >= 3 ? y : y - 1
  return `${startYear}-${String(startYear + 1).slice(2)}`
})()

const FY_OPTIONS = (() => {
  const fy: string[] = []
  const baseYear = parseInt(CURRENT_FY.split('-')[0])
  for (let i = 0; i < 4; i++) {
    const y = baseYear - i
    fy.push(`${y}-${String(y + 1).slice(2)}`)
  }
  return fy
})()

function pnlColor(v: number) {
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-500'
}

function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const valCls = positive === undefined
    ? 'text-zinc-900 dark:text-zinc-50'
    : positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${valCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-400">{sub}</p>}
    </div>
  )
}

function SummaryPanel({ report }: { report: TaxReport }) {
  const { stcg, ltcg } = report.summary

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Short-Term Capital Gains (STCG) — &lt;365 days · 20% tax
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Total Gains" value={`₹${stcg.gain.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={stcg.gain > 0 ? true : undefined} />
          <MetricCard label="Total Losses" value={`₹${Math.abs(stcg.loss).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={stcg.loss < 0 ? false : undefined} />
          <MetricCard label="Net STCG" value={`₹${stcg.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={stcg.net >= 0} />
          <MetricCard label="Est. Tax @20%" value={`₹${stcg.estimated_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Long-Term Capital Gains (LTCG) — ≥365 days · 12.5% on gains &gt;₹1,25,000
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Total Gains" value={`₹${ltcg.gain.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={ltcg.gain > 0 ? true : undefined} />
          <MetricCard label="Total Losses" value={`₹${Math.abs(ltcg.loss).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={ltcg.loss < 0 ? false : undefined} />
          <MetricCard label="Net LTCG" value={`₹${ltcg.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} positive={ltcg.net >= 0} />
          <MetricCard label="Est. Tax @12.5%" value={`₹${ltcg.estimated_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} />
        </div>
        <p className="mt-2 text-[10px] text-zinc-400">
          ₹1,25,000 exemption applied. Taxable LTCG: ₹{(ltcg.taxable ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Total P&L"
          value={`₹${report.summary.total_pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          positive={report.summary.total_pnl >= 0}
          sub={`${report.total_trades} closed trades`}
        />
        <MetricCard
          label="Estimated Total Tax"
          value={`₹${report.summary.estimated_total_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          sub="Consult a CA for exact liability"
        />
      </div>
    </div>
  )
}

function TradeTable({ trades }: { trades: TaxTrade[] }) {
  if (trades.length === 0) return (
    <div className="rounded-xl border border-zinc-200 bg-white py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm text-zinc-500">No closed trades in this period.</p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Symbol', 'Signal', 'Entry', 'Exit', 'Qty', 'Holding', 'Category', 'P&L'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-medium text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
              <td className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-200">
                {t.symbol.replace(/\.(NS|BO)$/, '')}
              </td>
              <td className="px-3 py-2">
                <span className={`font-semibold ${t.signal === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {t.signal}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">₹{t.entry_price.toFixed(2)}</td>
              <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">₹{t.exit_price.toFixed(2)}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{t.quantity}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{t.holding_days}d</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 font-semibold text-[10px] ${
                  t.category === 'LTCG'
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                }`}>
                  {t.category}
                </span>
              </td>
              <td className={`px-3 py-2 font-mono font-semibold ${pnlColor(t.pnl)}`}>
                {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TaxView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [fy, setFy] = useState(CURRENT_FY)
  const [mode, setMode] = useState<'paper' | 'live' | 'all'>('paper')
  const [report, setReport] = useState<TaxReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (t: string, fyParam: string, modeParam: string) => {
    setLoading(true)
    try {
      const data = await getTaxReport(t, fyParam, modeParam)
      setReport(data)
      writePageCache(`${REPORT_CACHE_KEY_PREFIX}${fyParam}:${modeParam}`, data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    // Show the last-known report for this FY/mode instantly (from a
    // previous visit) instead of a blank spinner, then load() below
    // fetches fresh data in the background and overwrites both state
    // and the cache. Deferred a microtask so the setState isn't
    // synchronous within the effect body (react-hooks/set-state-in-effect).
    const cached = readPageCache<TaxReport>(`${REPORT_CACHE_KEY_PREFIX}${fy}:${mode}`)
    if (cached) Promise.resolve().then(() => setReport(cached))
    load(t, fy, mode)
  }, [router, load, fy, mode])

  function downloadCsv() {
    exportTaxCsv(tokenRef.current, fy, mode)
  }

  if (!authChecked) return null

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Tax Report" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Tax P&amp;L Report</h1>
            <p className="text-xs text-zinc-400">
              Indian STCG / LTCG breakdown. Estimated figures — consult a CA for filing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fy}
              onChange={e => setFy(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {FY_OPTIONS.map(f => <option key={f} value={f}>FY {f}</option>)}
            </select>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as 'paper' | 'live' | 'all')}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="paper">Paper trades</option>
              <option value="live">Live trades</option>
              <option value="all">All trades</option>
            </select>
            <button
              onClick={downloadCsv}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Export CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : report ? (
          <div className="space-y-6">
            <SummaryPanel report={report} />
            <div>
              <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Trade-by-Trade Breakdown ({report.total_trades} trades)
              </h2>
              <TradeTable trades={report.trades} />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

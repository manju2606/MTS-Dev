'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { RsiReversionLiveView } from '@/components/rsi-reversion-live'
import {
  startStrategyLabRun, startTrendPullbackRun, startOrbRun, startRsiReversionRun, startIndexScanRun,
  listStrategyLabRuns, getStrategyLabRun, listStrategyLabResults, getStrategyLabResult, getResultMonteCarlo,
  listIndexScans, getIndexScan, getIndexScanRanking, listIndexUniverses, listMcxContracts, searchStocks,
  getMe, ApiError, getSymbolComparison, startSymbolSweepRun, getSymbolSweep, getLiveStrategyBacktest,
} from '@/lib/api'
import type {
  HistoricalDataInterval, StrategyLabRun, StrategyLabResultSummary, StrategyLabResultDetail, MonteCarloResult,
  IndexScanRun, IndexScanRankingRow, IndexUniverseOption, McxContractOption, StockSearchResult, RunSortBy,
  SymbolComparison, SymbolSweepRun, LiveBacktestSource, LiveStrategyBacktestResult,
} from '@/lib/api'

const INTERVALS: HistoricalDataInterval[] = [
  'minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day',
]
const ACTIVE_STATUSES = new Set(['pending', 'downloading', 'generating', 'running'])
const ACTIVE_SCAN_STATUSES = new Set(['pending', 'running'])
const ACTIVE_SWEEP_STATUSES = new Set(['pending', 'running'])

// Friendly display labels for INDEX_UNIVERSES keys (see backend
// strategy_lab_service.py) -- the API itself only returns the raw key,
// exchange, and symbol count; falls back to the raw key for any index
// added backend-side without a matching label here.
const INDEX_LABELS: Record<string, string> = {
  NIFTY50: 'NIFTY 50',
  NIFTY_MIDCAP_50: 'NIFTY Midcap 50',
  NIFTY_SMALLCAP_50: 'NIFTY Smallcap 50',
  MCX_ALL: 'MCX (All Contracts)',
}

// 'rsi_live' isn't a backtest run at all -- it's the same live-monitoring
// view as the MCX page's "RSI Strategy" tab (see RsiReversionLiveView),
// surfaced here too since this is where the strategy was actually
// discovered and validated (see the AI Strategy Lab conversation history:
// #1 ranked of 392 candidates for Natural Gas Mini). 'index_scan' runs the
// full generated sweep against every symbol in an index (see
// strategy_lab_service.start_index_scan_run) instead of a single symbol.
// 'symbol_sweep' is the inverse: every strategy family/version against one
// symbol (see strategy_lab_service.start_symbol_sweep_run), then reuses the
// same ranked view as 'compare' underneath its own progress panel.
type Mode =
  | 'generated' | 'trend_pullback' | 'orb' | 'rsi_reversion' | 'index_scan' | 'rsi_live' | 'compare'
  | 'symbol_sweep' | 'live_backtest'

// Top-level split: NSE-equity strategies vs MCX-commodity ones. The
// generated/trend_pullback/orb/rsi_reversion/index_scan/compare engines are
// exchange-agnostic underneath (same backend, symbol+exchange is just a
// form field) -- this only changes which modes are offered and which
// exchange the symbol picker defaults/locks to, so switching sections never
// requires a backend change. 'rsi_live' only ever made sense for MCX
// (Natural Gas Mini) and is now exclusively reachable from the MCX section;
// 'symbol_sweep'/'live_backtest' are NSE-equity specific (the underlying
// sources -- Golden Stock/BTST/SOTD/Chartink/Golden Egg -- are all NSE/BSE)
// and stay NSE-only.
type LabSection = 'NSE' | 'MCX'
const SECTION_MODES: Record<LabSection, Mode[]> = {
  NSE: ['generated', 'index_scan', 'trend_pullback', 'orb', 'rsi_reversion', 'symbol_sweep', 'live_backtest', 'compare'],
  MCX: ['generated', 'index_scan', 'trend_pullback', 'orb', 'rsi_reversion', 'rsi_live', 'compare'],
}
const SECTION_EXCHANGES: Record<LabSection, string[]> = { NSE: ['NSE', 'BSE', 'NFO'], MCX: ['MCX'] }

type SortKey = 'score' | 'cagr' | 'sharpe' | 'max_dd' | 'win_rate' | 'pf' | 'trades' | 'stability'
type SortDir = 'asc' | 'desc'

function sortValue(r: StrategyLabResultSummary, key: SortKey): number {
  switch (key) {
    case 'score': return r.composite_score
    case 'cagr': return r.full_metrics.cagr_pct
    case 'sharpe': return r.full_metrics.sharpe_ratio
    case 'max_dd': return r.full_metrics.max_drawdown_pct
    case 'win_rate': return r.full_metrics.win_rate_pct
    case 'pf': return r.full_metrics.profit_factor
    case 'trades': return r.full_metrics.total_trades
    case 'stability': return r.walk_forward.stability_score
  }
}

function sortResults(results: StrategyLabResultSummary[], key: SortKey, dir: SortDir): StrategyLabResultSummary[] {
  return [...results].sort((a, b) => {
    const diff = sortValue(a, key) - sortValue(b, key)
    return dir === 'desc' ? -diff : diff
  })
}

function SortTh({ label, k, sortKey, sortDir, onSort }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  return (
    <th
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-zinc-700 dark:hover:text-zinc-200 ${
        sortKey === k ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
      }`}
    >
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
    </th>
  )
}

// Same clickable-header convention as SortTh, but against Past Runs' own
// server-paginated sort (RunSortBy/1|-1) rather than the in-memory
// StrategyLabResultSummary sort SortTh/SortKey use.
function RunSortTh({ label, field, sortBy, sortDir, onSort }: {
  label: string; field: RunSortBy; sortBy: RunSortBy; sortDir: 1 | -1; onSort: (field: RunSortBy) => void
}) {
  return (
    <th
      onClick={() => onSort(field)}
      className={`cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-zinc-700 dark:hover:text-zinc-200 ${
        sortBy === field ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
      }`}
    >
      {label}{sortBy === field ? (sortDir === -1 ? ' ▼' : ' ▲') : ' ⇅'}
    </th>
  )
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function daysAgoStr(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// ── Lightweight inline SVG line chart (no external chart lib) ────────────────

function LineChart({ points, color, height = 160, formatY }: {
  points: { x: number; y: number }[]
  color: string
  height?: number
  formatY?: (v: number) => string
}) {
  if (points.length < 2) return <p className="py-8 text-center text-xs text-zinc-400">Not enough data.</p>
  const width = 100 // percent-based viewBox, scales via CSS
  const minY = Math.min(...points.map(p => p.y))
  const maxY = Math.max(...points.map(p => p.y))
  const rangeY = maxY - minY || 1
  const toSvgX = (i: number) => (i / (points.length - 1)) * width
  const toSvgY = (y: number) => height - ((y - minY) / rangeY) * (height - 20) - 10
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(i)} ${toSvgY(p.y)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full">
      <path d={path} fill="none" stroke={color} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      {formatY && (
        <>
          <text x="1" y="10" fontSize="4" fill="currentColor" className="text-zinc-400">{formatY(maxY)}</text>
          <text x="1" y={height - 2} fontSize="4" fill="currentColor" className="text-zinc-400">{formatY(minY)}</text>
        </>
      )}
    </svg>
  )
}

// ── Metric grid ────────────────────────────────────────────────────────────

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className={`text-sm font-bold ${accent ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
    </div>
  )
}

function MetricsGrid({ m }: { m: StrategyLabResultDetail['full_metrics'] }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      <Metric label="CAGR" value={`${m.cagr_pct.toFixed(1)}%`} accent={m.cagr_pct >= 0 ? 'text-emerald-600' : 'text-red-500'} />
      <Metric label="Sharpe" value={m.sharpe_ratio.toFixed(2)} />
      <Metric label="Sortino" value={m.sortino_ratio.toFixed(2)} />
      <Metric label="Max DD" value={`${m.max_drawdown_pct.toFixed(1)}%`} accent="text-red-500" />
      <Metric label="Win Rate" value={`${m.win_rate_pct.toFixed(1)}%`} />
      <Metric label="Profit Factor" value={m.profit_factor.toFixed(2)} />
      <Metric label="Trades" value={String(m.total_trades)} />
      <Metric label="Expectancy" value={`₹${m.expectancy.toFixed(0)}`} />
      <Metric label="Net P&L" value={`₹${m.net_pnl.toFixed(0)}`} accent={m.net_pnl >= 0 ? 'text-emerald-600' : 'text-red-500'} />
      <Metric label="Avg Hold" value={`${m.avg_holding_hours.toFixed(0)}h`} />
      <Metric label="Final Equity" value={`₹${m.final_equity.toLocaleString('en-IN')}`} />
      <Metric label="Recovery Factor" value={m.recovery_factor.toFixed(2)} />
    </div>
  )
}

// ── Compare Strategies ───────────────────────────────────────────────────

const COMPARE_FAMILY_LABELS: Record<string, string> = {
  generated: 'Auto-Generated (392-sweep)',
  trend_pullback: 'Trend Pullback',
  opening_range_breakout: 'Opening Range Breakout',
  rsi_reversion_v2: 'RSI Reversion',
}

function SymbolComparisonView({ result, loading, error, onOpenResult }: {
  result: SymbolComparison | null
  loading: boolean
  error: string | null
  onOpenResult: (runId: string) => void
}) {
  if (loading) {
    return (
      <div className="mt-6 flex justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      </div>
    )
  }
  if (error) {
    return (
      <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
        {error}
      </p>
    )
  }
  if (!result) {
    return (
      <p className="mt-6 text-xs text-zinc-400">
        Pick a symbol above and click &quot;Compare Strategies&quot; to see every completed backtest ever run for it
        (any mode -- Generate &amp; Backtest, Trend Pullback, ORB, RSI Reversion, an Index Scan child run), ranked by
        AI composite score.
      </p>
    )
  }
  if (result.rows.length === 0) {
    return (
      <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        No completed backtests yet for {result.symbol} — run one first (any mode above), then come back here to
        compare.
      </p>
    )
  }

  const maxScore = Math.max(...result.rows.map(r => r.composite_score), 1)
  const rankBadge = (i: number) =>
    i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-zinc-400' : i === 2 ? 'bg-amber-700' : 'bg-zinc-300 dark:bg-zinc-700'

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Top {result.rows.length} Strategies — {result.symbol}
        </p>
        <p className="text-[11px] text-zinc-400">
          {result.total_completed_runs} completed run{result.total_completed_runs === 1 ? '' : 's'} total
          {result.total_completed_runs > result.rows.length ? ` (showing top ${result.rows.length})` : ''}
        </p>
      </div>
      <div className="space-y-3">
        {result.rows.map((row, i) => {
          const m = row.metrics
          return (
            <div key={`${row.run_id}-${i}`} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${rankBadge(i)}`}>
                    {i + 1}
                  </span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    {row.candidate_name ?? 'Unnamed strategy'}
                  </span>
                  {row.family && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {COMPARE_FAMILY_LABELS[row.family] ?? row.family}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    {row.composite_score.toFixed(1)}/100
                  </span>
                  <button
                    onClick={() => onOpenResult(row.run_id)}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Details &amp; Monte Carlo →
                  </button>
                </div>
              </div>
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${(row.composite_score / maxScore) * 100}%` }}
                />
              </div>
              {m ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  <Metric label="CAGR" value={`${m.cagr_pct.toFixed(1)}%`} accent={m.cagr_pct >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                  <Metric label="Profit Factor" value={m.profit_factor.toFixed(2)} />
                  <Metric label="Max DD" value={`${m.max_drawdown_pct.toFixed(1)}%`} accent="text-red-500" />
                  <Metric label="Win Rate" value={`${m.win_rate_pct.toFixed(1)}%`} />
                  <Metric label="Trades" value={String(m.total_trades)} />
                  <Metric label="Net P&L" value={`₹${m.net_pnl.toFixed(0)}`} accent={m.net_pnl >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400">No metrics available</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Index Scan ───────────────────────────────────────────────────────────

function IndexScanPanel({ scan, ranking, sortKey, sortDir, onSort, onOpenSymbol }: {
  scan: IndexScanRun | null
  ranking: IndexScanRankingRow[] | null
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  onOpenSymbol: (runId: string) => void
}) {
  if (!scan) return null
  const progressPct = scan.total_symbols > 0 ? Math.round((scan.completed_symbols / scan.total_symbols) * 100) : 0

  return (
    <>
      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {scan.index} · {scan.exchange} · {scan.interval}
          </p>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
            scan.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            : scan.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }`}>
            {scan.status}
          </span>
        </div>
        {ACTIVE_SCAN_STATUSES.has(scan.status) && (
          <div className="mt-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              {scan.completed_symbols}/{scan.total_symbols} symbols scanned (392 candidates each)
            </p>
          </div>
        )}
        {scan.status === 'failed' && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{scan.error}</p>
        )}
        {scan.failed_symbols.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
            Skipped (no usable data or backtest error): {scan.failed_symbols.join(', ')}
          </p>
        )}
      </div>

      {ranking && ranking.length > 0 && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Best Stocks ({ranking.length}{scan.total_symbols ? ` of ${scan.total_symbols}` : ''})
            </p>
            <p className="text-[11px] text-zinc-400">Each row is that stock&apos;s own best-scoring strategy out of the 392 tested.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">#</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Symbol</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Best Strategy</th>
                  <SortTh label="Score" k="score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="CAGR" k="cagr" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Sharpe" k="sharpe" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Max DD" k="max_dd" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Win Rate" k="win_rate" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="PF" k="pf" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Trades" k="trades" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Stability" k="stability" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortResults(ranking, sortKey, sortDir).map((r, i) => {
                  const row = r as IndexScanRankingRow
                  return (
                    <tr key={row.run_id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                      <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                      <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{row.symbol}</td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-50">{row.candidate.name}</p>
                        <p className="text-[10px] text-zinc-400">{row.candidate.family}</p>
                      </td>
                      <td className="px-3 py-2 font-bold text-indigo-600 dark:text-indigo-400">{row.composite_score.toFixed(1)}</td>
                      <td className={`px-3 py-2 font-mono ${row.full_metrics.cagr_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {row.full_metrics.cagr_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{row.full_metrics.sharpe_ratio.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-red-500">{row.full_metrics.max_drawdown_pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{row.full_metrics.win_rate_pct.toFixed(0)}%</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{row.full_metrics.profit_factor.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-500">{row.full_metrics.total_trades}</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{row.walk_forward.stability_score.toFixed(0)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => onOpenSymbol(row.run_id)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                          Details →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Symbol Sweep -- inverse of Index Scan: every strategy, one symbol ──────

function sweepStepLabel(key: string): string {
  if (key === 'generated') return 'Generate & Backtest (392 candidates)'
  if (key === 'opening_range_breakout') return 'Opening Range Breakout'
  if (key.startsWith('trend_pullback_')) return `Trend Pullback ${key.replace('trend_pullback_', '')}`
  if (key.startsWith('rsi_reversion_')) return `RSI Reversion ${key.replace('rsi_reversion_', '')}`
  return key
}

function SymbolSweepPanel({ sweep }: { sweep: SymbolSweepRun | null }) {
  if (!sweep) return null
  const progressPct = sweep.total_strategies > 0
    ? Math.round((sweep.completed_strategies / sweep.total_strategies) * 100) : 0
  const doneKeys = Object.keys(sweep.child_run_ids)

  return (
    <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {sweep.symbol} · {sweep.exchange}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
          sweep.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
          : sweep.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
        }`}>
          {sweep.status}
        </span>
      </div>
      {ACTIVE_SWEEP_STATUSES.has(sweep.status) && (
        <div className="mt-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            {sweep.completed_strategies}/{sweep.total_strategies} strategies run
          </p>
        </div>
      )}
      {sweep.status === 'failed' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{sweep.error}</p>
      )}
      {doneKeys.length > 0 && (
        <p className="mt-3 text-[11px] text-zinc-400">
          Done: {doneKeys.map(sweepStepLabel).join(', ')}
        </p>
      )}
      {sweep.failed_strategies.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          Failed (no usable data or backtest error): {sweep.failed_strategies.map(sweepStepLabel).join(', ')}
        </p>
      )}
    </div>
  )
}

// ── Live Strategy Backtest -- Golden Stock/BTST/SOTD/Chartink/Golden Egg ────
// Backtests each strategy's own real historical picks (already recorded by
// its live resolver) rather than a synthetic re-simulation -- self-contained
// like RsiReversionLiveView, since it needs a strategy-source picker instead
// of the shared symbol/exchange form every other mode on this page uses.

const LIVE_BACKTEST_SOURCES: { value: LiveBacktestSource; label: string; emoji: string }[] = [
  { value: 'golden_stock', label: 'Golden Stock (Intraday)', emoji: '🔥' },
  { value: 'btst', label: 'BTST', emoji: '🌙' },
  { value: 'stock_of_day', label: 'Stock of the Day', emoji: '⭐' },
  { value: 'chartink', label: 'Chartink (Breakout Watchlist)', emoji: '🚨' },
  { value: 'golden_egg', label: 'Golden Egg', emoji: '🥚' },
]

// Golden Stock/BTST score each pick with confidence/RSI/volume-ratio
// (Golden Stock also has ADX; BTST doesn't track it -- see the backend's
// own _passes_gates()) -- the other three sources don't carry these fields
// on their picks at all, so the gate row only shows for these two.
const LIVE_BACKTEST_GATE_SOURCES = new Set<LiveBacktestSource>(['golden_stock', 'btst'])
const LIVE_BACKTEST_GATE_OFF = { minConfidence: '', maxRsi: '', minVolumeRatio: '', minAdx: '' }
// Sample starting point -- same numbers as the Chartink Breakout Watchlist's
// own quality gates, for consistency across the app: min AI Score 50%, ADX >
// 25 (real trend, not chop), volume ratio > 1.5x, RSI < 75 (not already
// overbought). Tune freely; "Clear gates" always turns filtering off
// entirely.
const LIVE_BACKTEST_GATE_DEFAULTS = { minConfidence: '50', maxRsi: '75', minVolumeRatio: '1.5', minAdx: '25' }
const LIVE_BACKTEST_GATE_STORAGE_KEY = 'mts_live_backtest_quality_gates'

function loadSavedLiveBacktestGates(): typeof LIVE_BACKTEST_GATE_DEFAULTS {
  if (typeof window === 'undefined') return LIVE_BACKTEST_GATE_DEFAULTS
  try {
    const raw = localStorage.getItem(LIVE_BACKTEST_GATE_STORAGE_KEY)
    if (raw) return { ...LIVE_BACKTEST_GATE_DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore corrupt storage */ }
  return LIVE_BACKTEST_GATE_DEFAULTS
}

function LiveStrategyBacktestPanel({ token }: { token: string }) {
  const [source, setSource] = useState<LiveBacktestSource>('golden_stock')
  const [fromDate, setFromDate] = useState(daysAgoStr(365))
  const [toDate, setToDate] = useState(todayStr())
  const [capital, setCapital] = useState(100000)
  const [gates, setGates] = useState(loadSavedLiveBacktestGates)
  const [justSaved, setJustSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LiveStrategyBacktestResult | null>(null)

  const showGates = LIVE_BACKTEST_GATE_SOURCES.has(source)
  const showAdxGate = source === 'golden_stock'
  const gatesActive = Object.values(gates).some(v => v !== '')
  const isCustom = JSON.stringify(gates) !== JSON.stringify(LIVE_BACKTEST_GATE_DEFAULTS)

  function saveGates() {
    try {
      localStorage.setItem(LIVE_BACKTEST_GATE_STORAGE_KEY, JSON.stringify(gates))
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 1500)
    } catch { /* storage full/unavailable */ }
  }

  async function run() {
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await getLiveStrategyBacktest(token, {
        source, from_date: fromDate, to_date: toDate, capital,
        ...(showGates && gates.minConfidence !== '' ? { min_confidence: Number(gates.minConfidence) } : {}),
        ...(showGates && gates.maxRsi !== '' ? { max_rsi: Number(gates.maxRsi) } : {}),
        ...(showGates && gates.minVolumeRatio !== '' ? { min_volume_ratio: Number(gates.minVolumeRatio) } : {}),
        ...(showAdxGate && gates.minAdx !== '' ? { min_adx: Number(gates.minAdx) } : {}),
      })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run backtest')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Live Strategy Backtest</p>
      <p className="mb-4 text-[11px] text-zinc-400">
        Backtests each strategy against its own real historical picks — the exact entry/SL/target prices and
        WIN/LOSS/EXPIRED outcomes each live scanner already recorded — not a synthetic re-simulation. Instant,
        since it&apos;s reading data these strategies already tracked rather than running a new scan.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {LIVE_BACKTEST_SOURCES.map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => { setSource(s.value); setResult(null); setError(null) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              source === s.value ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {showGates && (
        <div className="mb-4 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Quality gates — test if only the highest-conviction picks would&apos;ve been profitable
          </p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min AI Score %</label>
              <input
                type="number" min={0} max={100} placeholder="off" value={gates.minConfidence}
                onChange={e => setGates(g => ({ ...g, minConfidence: e.target.value }))}
                className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-zinc-400">Max RSI</label>
              <input
                type="number" min={0} max={100} placeholder="off" value={gates.maxRsi}
                onChange={e => setGates(g => ({ ...g, maxRsi: e.target.value }))}
                className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min Volume Ratio</label>
              <input
                type="number" min={0} step={0.1} placeholder="off" value={gates.minVolumeRatio}
                onChange={e => setGates(g => ({ ...g, minVolumeRatio: e.target.value }))}
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </div>
            {showAdxGate && (
              <div>
                <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min ADX</label>
                <input
                  type="number" min={0} max={100} placeholder="off" value={gates.minAdx}
                  onChange={e => setGates(g => ({ ...g, minAdx: e.target.value }))}
                  className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
              </div>
            )}
            <button
              onClick={() => setGates(LIVE_BACKTEST_GATE_DEFAULTS)}
              className="self-end rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              ↺ Default
            </button>
            {isCustom && (
              <button
                onClick={saveGates}
                className="self-end rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-indigo-500"
              >
                {justSaved ? '✓ Saved' : '💾 Save'}
              </button>
            )}
            {gatesActive && (
              <button
                onClick={() => setGates(LIVE_BACKTEST_GATE_OFF)}
                className="self-end rounded-lg px-2 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                ✕ Clear gates
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Capital per trade (₹)</label>
          <input type="number" min={1000} step={1000} value={capital} onChange={e => setCapital(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
        </div>
        <div className="flex items-end">
          <button
            onClick={run}
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {result && (
        result.total_trades === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
            <p className="text-2xl">🔬</p>
            <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {result.total_picks_before_gates === 0
                ? `No resolved picks yet for ${result.label}`
                : `No picks pass these quality gates`}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {result.total_picks_before_gates === 0
                ? 'Come back once this strategy has picks that hit target/stop-loss/expiry in the selected window.'
                : `${result.total_picks_before_gates} resolved pick${result.total_picks_before_gates === 1 ? '' : 's'} loaded, none met the current thresholds.`}
            </p>
          </div>
        ) : (
          <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <p className="mb-3 text-[11px] text-zinc-400">
              {result.total_trades} of {result.total_picks_before_gates} resolved pick{result.total_picks_before_gates === 1 ? '' : 's'} passed
              {' '}— {result.label}, ₹{capital.toLocaleString('en-IN')} deployed per trade
            </p>
            <MetricsGrid m={result.full_metrics} />

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Equity Curve</p>
                <LineChart
                  points={result.equity_curve.map((p, i) => ({ x: i, y: p.equity }))}
                  color="#4f46e5"
                  formatY={v => `₹${(v / 1000).toFixed(0)}k`}
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Drawdown</p>
                <LineChart
                  points={result.drawdown_curve.map((p, i) => ({ x: i, y: -p.drawdown_pct }))}
                  color="#ef4444"
                  formatY={v => `${v.toFixed(0)}%`}
                />
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Trades (most recent {result.trades.length} of {result.total_trades})
              </p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Entry', 'Exit', 'Entry ₹', 'Exit ₹', 'Qty', 'P&L', 'P&L %', 'Reason'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-300">{t.entry_time.slice(0, 16).replace('T', ' ')}</td>
                        <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-300">{t.exit_time.slice(0, 16).replace('T', ' ')}</td>
                        <td className="px-2 py-1.5 font-mono">{t.entry_price.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono">{t.exit_price.toFixed(2)}</td>
                        <td className="px-2 py-1.5">{t.quantity}</td>
                        <td className={`px-2 py-1.5 font-mono font-semibold ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{t.pnl.toFixed(0)}</td>
                        <td className={`px-2 py-1.5 font-mono ${t.pnl_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{t.pnl_pct.toFixed(1)}%</td>
                        <td className="px-2 py-1.5 text-zinc-500">{t.exit_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

export default function StrategyLabView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)

  const [section, setSection] = useState<LabSection>('NSE')
  const [mode, setMode] = useState<Mode>('generated')
  const [trendPullbackVersion, setTrendPullbackVersion] = useState<'v1.0' | 'v2.0'>('v2.0')
  const [rsiReversionVersion, setRsiReversionVersion] = useState<'v1.0' | 'v2.0' | 'v2.1' | 'v2.2' | 'v3.0' | 'v4.0'>('v1.0')
  const [exchange, setExchange] = useState('NSE')
  const [symbol, setSymbol] = useState('')
  const [symbolLabel, setSymbolLabel] = useState('')
  const [mcxContracts, setMcxContracts] = useState<McxContractOption[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState<StockSearchResult[]>([])
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [interval, setIntervalOption] = useState<HistoricalDataInterval>('day')
  const [fromDate, setFromDate] = useState(daysAgoStr(730))
  const [toDate, setToDate] = useState(todayStr())
  const [compareResult, setCompareResult] = useState<SymbolComparison | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [capital, setCapital] = useState(100000)

  const [starting, setStarting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [runs, setRuns] = useState<StrategyLabRun[]>([])
  const [runsTotal, setRunsTotal] = useState(0)
  const [runsPage, setRunsPage] = useState(0)
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsSortBy, setRunsSortBy] = useState<RunSortBy>('created_at')
  const [runsSortDir, setRunsSortDir] = useState<1 | -1>(-1)
  const PAST_RUNS_PAGE_SIZE = 25
  const [activeRun, setActiveRun] = useState<StrategyLabRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [results, setResults] = useState<StrategyLabResultSummary[] | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [detail, setDetail] = useState<StrategyLabResultDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null)
  const [monteCarloLoading, setMonteCarloLoading] = useState(false)
  const [monteCarloError, setMonteCarloError] = useState<string | null>(null)

  const [indexScanIndex, setIndexScanIndex] = useState('NIFTY50')
  const [indexUniverses, setIndexUniverses] = useState<IndexUniverseOption[]>([])
  const [activeScan, setActiveScan] = useState<IndexScanRun | null>(null)
  const [scanRanking, setScanRanking] = useState<IndexScanRankingRow[] | null>(null)
  const [pastScans, setPastScans] = useState<IndexScanRun[]>([])
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [activeSweep, setActiveSweep] = useState<SymbolSweepRun | null>(null)
  const sweepPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // Fetches a specific page (0-indexed) under the current sort, replacing
  // whatever's currently shown -- page-number pagination, not an
  // accumulating "Load more" list.
  function loadRunsPage(page: number, sortBy: RunSortBy = runsSortBy, sortDir: 1 | -1 = runsSortDir) {
    setRunsLoading(true)
    listStrategyLabRuns(tokenRef.current, PAST_RUNS_PAGE_SIZE, page * PAST_RUNS_PAGE_SIZE, sortBy, sortDir)
      .then(({ runs: r, total }) => { setRuns(r); setRunsTotal(total); setRunsPage(page) })
      .catch(() => {})
      .finally(() => setRunsLoading(false))
  }

  // Re-fetches the current page/sort (e.g. after starting a new run, so it
  // shows up without the user needing to page back to page 1 themselves --
  // unless they've paged forward, in which case page 1 has the new run).
  function reloadRuns() {
    loadRunsPage(0)
  }

  // Column-header click: same field toggles direction, a new field starts
  // descending -- same convention as handleSort/SortTh elsewhere on this
  // page, just against the server-paginated Past Runs list instead of an
  // in-memory results array, so it always resets to page 1.
  function handleRunsSort(field: RunSortBy) {
    const nextDir: 1 | -1 = runsSortBy === field ? (runsSortDir === -1 ? 1 : -1) : -1
    setRunsSortBy(field)
    setRunsSortDir(nextDir)
    loadRunsPage(0, field, nextDir)
  }

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const id = setTimeout(() => setAuthChecked(true), 0)
    listMcxContracts(t).then(setMcxContracts).catch(() => {})
    listStrategyLabRuns(t, PAST_RUNS_PAGE_SIZE, 0, 'created_at', -1)
      .then(({ runs: r, total }) => { setRuns(r); setRunsTotal(total) })
      .catch(() => {})
    listIndexScans(t).then(setPastScans).catch(() => {})
    listIndexUniverses(t).then(setIndexUniverses).catch(() => {})
    return () => clearTimeout(id)
  }, [router])

  // Session-expiry check: a token that exists in localStorage but is no
  // longer valid (past ACCESS_TOKEN_EXPIRE_MINUTES, no refresh endpoint
  // exists yet) otherwise leaves every picker on this page silently 401ing
  // forever with no indication to the user that re-login would fix it --
  // listMcxContracts/searchStocks both swallow a failed fetch into an empty
  // array, so an expired token just looks like an empty dropdown (e.g. "NG"
  // missing) with zero error shown. Same fix as the Historical Data page.
  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) return
    const checkSession = () => {
      getMe(t).catch(err => { if (err instanceof ApiError && err.status === 401) router.replace('/login') })
    }
    checkSession()
    const id = setInterval(checkSession, 60_000)
    return () => clearInterval(id)
  }, [router])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => {
    return () => { if (scanPollRef.current) clearInterval(scanPollRef.current) }
  }, [])

  useEffect(() => {
    return () => { if (sweepPollRef.current) clearInterval(sweepPollRef.current) }
  }, [])

  function watchSweep(sweepId: string, sweepSymbol: string) {
    if (sweepPollRef.current) clearInterval(sweepPollRef.current)
    sweepPollRef.current = setInterval(async () => {
      try {
        const sweep = await getSymbolSweep(tokenRef.current, sweepId)
        setActiveSweep(sweep)
        // Live-updating ranked comparison -- safe to poll while still
        // running, same reasoning as Index Scan's ranking poll: each
        // completed step is an ordinary StrategyLabRun already picked up by
        // get_symbol_comparison, so this just reflects whatever has
        // finished so far.
        getSymbolComparison(tokenRef.current, sweepSymbol, 10).then(setCompareResult).catch(() => {})
        if (!ACTIVE_SWEEP_STATUSES.has(sweep.status) && sweepPollRef.current) {
          clearInterval(sweepPollRef.current)
        }
      } catch { /* transient poll failure, try again next tick */ }
    }, 3000)
  }

  function watchScan(scanId: string) {
    if (scanPollRef.current) clearInterval(scanPollRef.current)
    scanPollRef.current = setInterval(async () => {
      try {
        const scan = await getIndexScan(tokenRef.current, scanId)
        setActiveScan(scan)
        // Live-updating leaderboard -- safe to poll while still running,
        // see get_index_scan_ranking's own docstring (it just reads
        // whatever child runs have completed so far).
        getIndexScanRanking(tokenRef.current, scanId).then(setScanRanking).catch(() => {})
        if (!ACTIVE_SCAN_STATUSES.has(scan.status) && scanPollRef.current) {
          clearInterval(scanPollRef.current)
        }
      } catch { /* transient poll failure, try again next tick */ }
    }, 3000)
  }

  // Restores a scan after a page refresh (activeScan/scanRanking otherwise
  // only ever get set by starting a brand new scan) -- e.g. re-opening the
  // NIFTY 50 scan's completed leaderboard without re-running anything.
  async function openPastScan(scan: IndexScanRun) {
    setMode('index_scan')
    setActiveScan(scan)
    setScanRanking(null)
    getIndexScanRanking(tokenRef.current, scan.id).then(setScanRanking).catch(() => {})
    if (ACTIVE_SCAN_STATUSES.has(scan.status)) watchScan(scan.id)
  }

  function handleExchangeChange(next: string) {
    setExchange(next)
    setSymbol('')
    setSymbolLabel('')
    setSearchQuery('')
    setSearchSuggestions([])
  }

  function handleSearchChange(val: string) {
    setSearchQuery(val)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (val.trim().length < 2) { setSearchSuggestions([]); return }
    searchDebounce.current = setTimeout(() => {
      searchStocks(tokenRef.current, val).then(setSearchSuggestions)
    }, 250)
  }

  function pickStock(r: StockSearchResult) {
    const clean = r.symbol.replace('.NS', '').replace('.BO', '')
    setSymbol(clean)
    setSymbolLabel(`${clean} — ${r.name}`)
    setSearchQuery('')
    setSearchSuggestions([])
  }

  function pickMcx(value: string) {
    setSymbol(value)
    setSymbolLabel(mcxContracts.find(c => c.value === value)?.label ?? value)
  }

  function watchRun(runId: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const run = await getStrategyLabRun(tokenRef.current, runId)
        setActiveRun(run)
        if (!ACTIVE_STATUSES.has(run.status)) {
          if (pollRef.current) clearInterval(pollRef.current)
          if (run.status === 'completed') {
            const res = await listStrategyLabResults(tokenRef.current, runId)
            setResults(res)
          }
          reloadRuns()
        }
      } catch { /* transient poll failure, try again next tick */ }
    }, 2000)
  }

  function handleSectionChange(next: LabSection) {
    setSection(next)
    setExchange(SECTION_EXCHANGES[next][0])
    setSymbol(''); setSymbolLabel(''); setSearchQuery(''); setSearchSuggestions([])
    if (!SECTION_MODES[next].includes(mode)) handleModeChange('generated')
    if (next === 'MCX' && indexScanIndex !== 'MCX_ALL') handleIndexScanIndexChange('MCX_ALL')
    if (next === 'NSE' && indexScanIndex === 'MCX_ALL') handleIndexScanIndexChange('NIFTY50')
  }

  function handleModeChange(next: Mode) {
    setMode(next)
    setMsg(null)
    if (next === 'trend_pullback' || next === 'rsi_reversion') {
      // Both were originally validated on MCX (Natural Gas Mini) and MCX
      // futures roll monthly with only the current contract retained, so a
      // long lookback isn't achievable there -- default to a realistic
      // window. Not exchange-locked though: either strategy runs against any
      // exchange the backend accepts (NSE/BSE/NFO/MCX), so the exchange
      // picker below stays a free choice instead of forcing MCX.
      setFromDate(daysAgoStr(180))
    } else if (next === 'symbol_sweep') {
      setFromDate(daysAgoStr(90))
    } else {
      setFromDate(daysAgoStr(next === 'orb' ? 90 : 730))
    }
    if (next === 'orb' && interval === 'day') setIntervalOption('5minute')
  }

  // MCX_ALL's contracts roll monthly (Kite only lists the current one), so
  // a 2-year daily-candle default -- fine for the NSE index universes --
  // would starve most MCX contracts below MIN_CANDLES_REQUIRED. Switching
  // to it defaults to a realistic short window at 5-minute candles instead,
  // same reasoning as trend_pullback/rsi_reversion's own MCX-aware default.
  function handleIndexScanIndexChange(next: string) {
    setIndexScanIndex(next)
    if (next === 'MCX_ALL') {
      setFromDate(daysAgoStr(180))
      setIntervalOption('5minute')
    } else {
      setFromDate(daysAgoStr(730))
      setIntervalOption('day')
    }
  }

  async function handleStart() {
    if (mode !== 'index_scan' && !symbol) return
    setStarting(true); setMsg(null); setResults(null); setDetail(null)
    try {
      if (mode === 'index_scan') {
        setActiveScan(null); setScanRanking(null)
        const { scan_id } = await startIndexScanRun(tokenRef.current, {
          index: indexScanIndex, interval, from_date: fromDate, to_date: toDate, capital,
        })
        const scan = await getIndexScan(tokenRef.current, scan_id)
        setActiveScan(scan)
        watchScan(scan_id)
        listIndexScans(tokenRef.current).then(setPastScans).catch(() => {})
        return
      }
      if (mode === 'symbol_sweep') {
        setActiveSweep(null); setCompareResult(null); setCompareError(null)
        const { sweep_id } = await startSymbolSweepRun(tokenRef.current, {
          symbol, exchange, interval, from_date: fromDate, to_date: toDate, capital,
        })
        const sweep = await getSymbolSweep(tokenRef.current, sweep_id)
        setActiveSweep(sweep)
        watchSweep(sweep_id, symbol)
        return
      }
      const { run_id } = mode === 'trend_pullback'
        ? await startTrendPullbackRun(tokenRef.current, {
            symbol, exchange, from_date: fromDate, to_date: toDate, capital,
            version: trendPullbackVersion,
          })
        : mode === 'orb'
        ? await startOrbRun(tokenRef.current, {
            symbol, exchange, interval, from_date: fromDate, to_date: toDate, capital,
          })
        : mode === 'rsi_reversion'
        ? await startRsiReversionRun(tokenRef.current, {
            symbol, exchange, from_date: fromDate, to_date: toDate, capital,
            version: rsiReversionVersion,
          })
        : await startStrategyLabRun(tokenRef.current, {
            symbol, exchange, interval, from_date: fromDate, to_date: toDate, capital,
          })
      const run = await getStrategyLabRun(tokenRef.current, run_id)
      setActiveRun(run)
      watchRun(run_id)
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Failed to start run' })
    } finally { setStarting(false) }
  }

  async function handleCompare() {
    if (!symbol) return
    setCompareLoading(true); setCompareError(null); setCompareResult(null)
    try {
      const result = await getSymbolComparison(tokenRef.current, symbol, 10)
      setCompareResult(result)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to fetch comparison')
    } finally { setCompareLoading(false) }
  }

  // Opens a symbol's own full run+result (its child StrategyLabRun from the
  // index scan) using the exact same detail view as a normal single-symbol
  // run -- switches mode to 'generated' since that's the view that renders
  // results/detail, matching every symbol's actual family/mode (the index
  // scan only ever runs the "generated" 392-candidate sweep).
  async function openIndexScanSymbol(runId: string) {
    setMode('generated')
    setDetail(null)
    const run = await getStrategyLabRun(tokenRef.current, runId)
    setActiveRun(run)
    if (run.status === 'completed') {
      const res = await listStrategyLabResults(tokenRef.current, runId)
      setResults(res)
    } else {
      setResults(null)
    }
  }

  // Opens a Compare/Symbol Sweep row's run and jumps straight to its own
  // top-scoring result's full detail (equity/drawdown/trades) -- same
  // 'generated' mode trick as openIndexScanSymbol so the existing detail
  // panel (which is where the "Run Monte Carlo Simulations" button lives)
  // renders regardless of that run's actual strategy family.
  async function openComparisonResult(runId: string) {
    setMode('generated')
    setDetail(null)
    setMonteCarlo(null); setMonteCarloError(null)
    const run = await getStrategyLabRun(tokenRef.current, runId)
    setActiveRun(run)
    if (run.status !== 'completed') {
      setResults(null)
      return
    }
    const res = await listStrategyLabResults(tokenRef.current, runId)
    setResults(res)
    if (res.length > 0) {
      setDetailLoading(true)
      try {
        const d = await getStrategyLabResult(tokenRef.current, runId, res[0].id)
        setDetail(d)
      } catch { /* ignore */ } finally { setDetailLoading(false) }
    }
  }

  async function openPastRun(run: StrategyLabRun) {
    setActiveRun(run)
    setDetail(null)
    if (run.status === 'completed') {
      const res = await listStrategyLabResults(tokenRef.current, run.id)
      setResults(res)
    } else if (ACTIVE_STATUSES.has(run.status)) {
      setResults(null)
      watchRun(run.id)
    } else {
      setResults(null)
    }
  }

  async function openDetail(resultId: string) {
    if (!activeRun) return
    setDetailLoading(true)
    setMonteCarlo(null); setMonteCarloError(null)
    try {
      const d = await getStrategyLabResult(tokenRef.current, activeRun.id, resultId)
      setDetail(d)
    } catch { /* ignore */ } finally { setDetailLoading(false) }
  }

  async function runMonteCarlo() {
    if (!activeRun || !detail) return
    setMonteCarloLoading(true); setMonteCarloError(null)
    try {
      const mc = await getResultMonteCarlo(tokenRef.current, activeRun.id, detail.id)
      setMonteCarlo(mc)
    } catch (e) {
      setMonteCarloError(e instanceof Error ? e.message : 'Failed to run Monte Carlo simulation')
    } finally {
      setMonteCarloLoading(false)
    }
  }

  if (!authChecked) return null

  const progressPct = activeRun && activeRun.total_candidates > 0
    ? Math.round((activeRun.completed_candidates / activeRun.total_candidates) * 100)
    : 0

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="AI Strategy Lab" />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Strategy Lab</h1>
        <p className="mb-8 text-xs text-zinc-400">
          Auto-generates hundreds of parameterized strategy variants, backtests each with realistic
          costs and stop-loss/target/trailing-stop management, validates out-of-sample via walk-forward,
          and ranks them by a composite score. Uses the historical data store (auto-downloads via your
          connected Zerodha account if missing).
        </p>

        {/* Run config */}
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Run</p>

          <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
            {(['NSE', 'MCX'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSectionChange(s)}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  section === s ? 'bg-white text-zinc-900 shadow dark:bg-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {s === 'NSE' ? 'NSE (Equity)' : 'MCX (Commodities)'}
              </button>
            ))}
          </div>

          {section === 'MCX' && (
            <p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Every mode below runs against real MCX futures candles via your connected Zerodha account —
              pick any contract in the Symbol dropdown, including Gold and Silver (Standard/Mini/Micro/100/Ten/
              Guinea/Petal variants) alongside Natural Gas and the base metals. RSI Reversion (Live) is Natural
              Gas Mini-only, the only contract it&apos;s been validated for.
            </p>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {SECTION_MODES[section].includes('generated') && (
            <button
              type="button"
              onClick={() => handleModeChange('generated')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'generated' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Generate &amp; Backtest (auto)
            </button>
            )}
            {SECTION_MODES[section].includes('index_scan') && (
            <button
              type="button"
              onClick={() => handleModeChange('index_scan')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'index_scan' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Index Scan
            </button>
            )}
            {SECTION_MODES[section].includes('trend_pullback') && (
            <button
              type="button"
              onClick={() => handleModeChange('trend_pullback')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'trend_pullback' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Trend Pullback (hand-designed)
            </button>
            )}
            {SECTION_MODES[section].includes('orb') && (
            <button
              type="button"
              onClick={() => handleModeChange('orb')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'orb' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Opening Range Breakout
            </button>
            )}
            {SECTION_MODES[section].includes('rsi_reversion') && (
            <button
              type="button"
              onClick={() => handleModeChange('rsi_reversion')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'rsi_reversion' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              RSI Reversion (Backtest)
            </button>
            )}
            {SECTION_MODES[section].includes('symbol_sweep') && (
            <button
              type="button"
              onClick={() => handleModeChange('symbol_sweep')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'symbol_sweep' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Run All Strategies
            </button>
            )}
            {SECTION_MODES[section].includes('rsi_live') && (
            <button
              type="button"
              onClick={() => handleModeChange('rsi_live')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'rsi_live' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              RSI Reversion (Live)
            </button>
            )}
            {SECTION_MODES[section].includes('live_backtest') && (
            <button
              type="button"
              onClick={() => handleModeChange('live_backtest')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'live_backtest' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Live Strategy Backtest
            </button>
            )}
            {SECTION_MODES[section].includes('compare') && (
            <button
              type="button"
              onClick={() => handleModeChange('compare')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'compare' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Compare Strategies
            </button>
            )}
          </div>

          {mode === 'rsi_live' && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Not a backtest run — this is the same live monitoring view as the MCX page&apos;s &quot;RSI Strategy&quot;
              tab, fixed to Natural Gas Mini (the only contract this strategy is validated for). See below.
            </p>
          )}

          {mode === 'live_backtest' && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Backtests Golden Stock, BTST, Stock of the Day, Chartink, or Golden Egg against their own real
              historical picks — pick a strategy and date range below.
            </p>
          )}

          {mode !== 'rsi_live' && mode !== 'live_backtest' && (
          <>
          {mode === 'trend_pullback' && (
            <div className="mb-4">
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTrendPullbackVersion('v1.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    trendPullbackVersion === 'v1.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v1.0 (original)
                </button>
                <button
                  type="button"
                  onClick={() => setTrendPullbackVersion('v2.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    trendPullbackVersion === 'v2.0' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v2.0 (tightened risk controls)
                </button>
              </div>
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                {trendPullbackVersion === 'v1.0' ? (
                  <>5-min execution with a 1H 200 EMA trend filter: buy above the 1H 200EMA when EMA20&gt;EMA50
                  (5m), ADX&gt;25, price pulls back to EMA20 (within 0.3%), bullish close, volume above average.
                  Stop: entry − 1×ATR. Target: entry + 2.5×ATR, with an early exit on a SuperTrend flip.</>
                ) : (
                  <>Same structure as v1.0, but with ADX&gt;35 (was 25), stop at 1.5×ATR (was 1×), and a tighter
                  0.15% pullback tolerance (was 0.3%) — changes a real parameter sweep against live NG data
                  showed consistently cut drawdown and improved profit factor. This is a validated{' '}
                  <strong>risk-reduction</strong> upgrade, not a validated profitable edge — there isn&apos;t
                  enough MCX history available yet to confirm true profitability with confidence.</>
                )}
                {' '}For MCX symbols, Kite only retains data for the currently-listed contract (no multi-year
                history), so the achievable date range is usually just the last few months.
              </p>
            </div>
          )}
          {mode === 'orb' && (
            <p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Opening range = the high/low of 09:00–09:30 each trading day. Buy the first breakout above
              that high (after 09:30) with volume above its 20-bar average — at most one trade per day.
              Stop: the opening range&apos;s low. Target: entry + 2×ATR. Any position still open at day&apos;s
              end is squared off there. Intraday by design — pick a 1-30 min interval.
            </p>
          )}
          {mode === 'rsi_reversion' && (
            <div className="mb-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v1.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v1.0' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v1.0 (long-only, validated)
                </button>
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v2.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v2.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v2.0 (adds short leg — live, base for v2.1/v2.2)
                </button>
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v2.1')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v2.1' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v2.1 (+ regime filter, ADX&lt;25)
                </button>
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v2.2')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v2.2' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v2.2 (+ regime filter, ADX&lt;30)
                </button>
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v3.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v3.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v3.0 (+ Time &amp; Volatility filters — tested, underperforms v2.0)
                </button>
                <button
                  type="button"
                  onClick={() => setRsiReversionVersion('v4.0')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    rsiReversionVersion === 'v4.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  v4.0 (+ partial profit-taking — promising, thin sample)
                </button>
              </div>
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                {rsiReversionVersion === 'v1.0' ? (
                  <>Long-only: buy when RSI-14 drops below 20 (oversold), while flat. Stop: entry − 2.5%, trailing up
                  to close × (1 − 2.0%) once favorable. Target: entry + 5.0%. Exits early if RSI climbs back above
                  80. This is the exact logic already deployed live for Natural Gas Mini (see the MCX page&apos;s RSI
                  Strategy tab) — the baseline to compare v2.0/v3.0 against.</>
                ) : rsiReversionVersion === 'v2.0' ? (
                  <>Adds a short leg, a symmetric mirror of the long side: short when RSI rises above 80 while flat,
                  cover on the mirrored stop/trailing-stop/target, or early if RSI drops back below 20. A real
                  backtest found this roughly doubles trade count and raw P&amp;L vs v1.0, but per-trade expectancy,
                  profit factor, and max drawdown all come out <strong>worse</strong> — it was deployed live because
                  a short leg was explicitly requested, not because it beat v1.0.
                  <strong> v2.2 (below) is the validated fix</strong> for that weakness and is now the live default
                  for Natural Gas Mini.</>
                ) : rsiReversionVersion === 'v2.1' ? (
                  <>Everything in v2.0 (long+short), plus a <strong>regime filter</strong>: no new entries while
                  ADX-14 ≥ 25 (a strongly trending market, where mean-reversion tends to fight the trend and lose).
                  Backtested improvement over v2.0 with better Monte Carlo tail-risk (lower 95th-percentile
                  drawdown) but on a much thinner trade sample (~83% fewer trades than v2.0).
                  <strong> Backtest-only</strong> — v2.2 was promoted to live instead for its larger, more
                  walk-forward-consistent sample; re-run this to judge the tradeoff yourself.</>
                ) : rsiReversionVersion === 'v2.2' ? (
                  <>Same idea as v2.1, with a looser regime threshold: no new entries while ADX-14 ≥ 30. More trades
                  and the tightest walk-forward (train vs test) consistency of any variant tested (profit factor
                  2.46 train vs 2.51 test) — trades off some of v2.1&apos;s Monte Carlo tail-risk edge for that
                  consistency and sample size. <strong>This is the current live default</strong> for Natural Gas
                  Mini (see the MCX page&apos;s RSI Strategy tab) — new entries send an email/push alert, and a
                  held-back entry (regime filter active) sends a once-daily informational notice.</>
                ) : rsiReversionVersion === 'v3.0' ? (
                  <>Everything in v2.0 (long+short), plus two more rules. <strong>Time Filter:</strong> no new entries
                  30min before / 60min after the weekly EIA Natural Gas Storage Report (Thu 10:30 AM ET) — volatility
                  and slippage risk spikes around it; you get a notification when a signal is actually held back for
                  this reason, live. <strong>Volatility Filter:</strong> when ATR ≥ 1.3× its 20-bar average, the stop
                  widens 1.5×; at ≥ 2.0× the entry is skipped entirely. <strong>Tested and rejected</strong> — a real
                  backtest comparison found it underperforms v2.0 (lower net profit, no drawdown improvement to
                  justify the extra complexity), so v2.0 was kept live instead. Kept here for reference/comparison,
                  not recommended.</>
                ) : (
                  <>Same base as v2.2 (long+short + ADX&lt;30 regime filter), plus <strong>Partial Profit-Taking</strong>:
                  instead of closing the whole position at the fixed target, 50% is closed there and the remainder
                  runs with no fixed ceiling — only the stop/trailing-stop/RSI exit — so a trade that keeps extending
                  captures more of the move. A real 180-day backtest showed every headline metric improve over v2.2
                  (profit factor 2.99 vs 2.49, expectancy +18%, same 4.37% max drawdown, better Monte Carlo tail
                  risk) — <strong>but only 3 of 24 trades ever triggered the mechanic</strong>, and the walk-forward
                  test-period profit factor (3.99) exceeding train (2.51) is the same thin-sample shape that got
                  v3.1 rejected earlier. Promising, not yet trusted — re-run this as more NGMINI history accumulates
                  before considering it for live alerting.</>
                )}
              </p>
            </div>
          )}

          <div className={`mb-4 grid grid-cols-2 gap-3 ${mode === 'compare' ? '' : 'sm:grid-cols-4'}`}>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Exchange</label>
              {mode === 'index_scan' ? (
                <div className="flex h-[30px] w-full items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
                  {(indexUniverses.find(u => u.index === indexScanIndex)?.exchange ?? '…')} (fixed by index)
                </div>
              ) : (
                <select value={exchange} onChange={e => handleExchangeChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  {SECTION_EXCHANGES[section].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
            </div>
            {mode === 'compare' ? null : mode !== 'trend_pullback' && mode !== 'rsi_reversion' ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Interval</label>
                <select value={interval} onChange={e => setIntervalOption(e.target.value as HistoricalDataInterval)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Interval</label>
                <div className="flex h-[30px] w-full items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
                  5-minute (fixed)
                </div>
              </div>
            )}
            {mode !== 'compare' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">From</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">To</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
                </div>
              </>
            )}
          </div>

          {mode === 'index_scan' ? (
            <>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Index</label>
              <select value={indexScanIndex} onChange={e => handleIndexScanIndexChange(e.target.value)}
                className="mb-3 w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                {indexUniverses.filter(u => (u.exchange === 'MCX') === (section === 'MCX')).map(u => (
                  <option key={u.index} value={u.index}>
                    {INDEX_LABELS[u.index] ?? u.index} ({u.symbol_count} · {u.exchange})
                  </option>
                ))}
              </select>
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Runs the full 392-candidate sweep on every constituent
                ({indexUniverses.find(u => u.index === indexScanIndex)?.symbol_count ?? '…'} symbols) sequentially,
                one full symbol run at a time — this can take a while (candle download + ~400 backtests per symbol).
                Progress and a live leaderboard appear below once started; you can navigate away and come back.
                {indexScanIndex.startsWith('NIFTY_MIDCAP') || indexScanIndex.startsWith('NIFTY_SMALLCAP') ? (
                  <> Midcap/Smallcap constituent lists are best-effort (lower confidence than NIFTY 50 — this index
                  reconstitutes more often and isn&apos;t pulled from a live membership source); a wrong/delisted
                  symbol just fails cleanly for that one stock, shown in the scan&apos;s skipped-symbols list.</>
                ) : null}
              </p>
            </>
          ) : (
          <>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Symbol {exchange === 'MCX' ? '(pick a contract)' : '(search)'}
          </label>
          {exchange === 'MCX' ? (
            <select value={symbol} onChange={e => e.target.value && pickMcx(e.target.value)}
              className="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <option value="">Select a contract…</option>
              {mcxContracts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ) : (
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Type to filter (e.g. RELIANCE, TCS…)"
                autoComplete="off"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <select
                value={symbol}
                onChange={e => {
                  const match = searchSuggestions.find(r => r.symbol === e.target.value)
                  if (match) pickStock(match)
                }}
                disabled={searchSuggestions.length === 0}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">
                  {searchSuggestions.length === 0 ? 'Type at least 2 letters…' : 'Select a symbol…'}
                </option>
                {searchSuggestions.map(r => (
                  <option key={r.symbol} value={r.symbol}>
                    {r.symbol.replace('.NS', '').replace('.BO', '')} — {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {symbol && exchange !== 'MCX' && (
            <p className="-mt-2 mb-3 text-[11px] text-emerald-600 dark:text-emerald-400">Selected: {symbolLabel}</p>
          )}
          {mode === 'symbol_sweep' && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Runs every strategy against this symbol, one at a time — Opening Range Breakout, both Trend Pullback
              versions, every RSI Reversion version, then the generated 392-candidate sweep last (it&apos;s the
              slowest). Progress and a live-updating ranked comparison appear below once started; you can navigate
              away and come back.
            </p>
          )}
          </>
          )}

          {mode !== 'compare' && (
            <>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Capital (₹)</label>
              <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))} min={1000} step={1000}
                className="mb-4 w-full max-w-[200px] rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </>
          )}

          <div>
            <button
              onClick={mode === 'compare' ? handleCompare : handleStart}
              disabled={
                mode === 'compare'
                  ? compareLoading || !symbol
                  : starting || (mode !== 'index_scan' && !symbol)
                    || (activeRun !== null && ACTIVE_STATUSES.has(activeRun.status))
                    || (activeScan !== null && ACTIVE_SCAN_STATUSES.has(activeScan.status))
                    || (activeSweep !== null && ACTIVE_SWEEP_STATUSES.has(activeSweep.status))
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {mode === 'compare'
                ? (compareLoading ? 'Comparing…' : 'Compare Strategies')
                : starting ? 'Starting…' : mode === 'trend_pullback' ? 'Run Trend Pullback Backtest' : mode === 'orb' ? 'Run Opening Range Breakout Backtest' : mode === 'rsi_reversion' ? `Run RSI Reversion ${rsiReversionVersion} Backtest` : mode === 'index_scan' ? `Scan ${INDEX_LABELS[indexScanIndex] ?? indexScanIndex}` : mode === 'symbol_sweep' ? 'Run All Strategies' : 'Generate & Backtest'}
            </button>
          </div>
          </>
          )}
        </div>

        {mode === 'rsi_live' && <RsiReversionLiveView />}

        {mode === 'live_backtest' && <LiveStrategyBacktestPanel token={tokenRef.current} />}

        {mode === 'compare' && (
          <SymbolComparisonView
            result={compareResult} loading={compareLoading} error={compareError}
            onOpenResult={openComparisonResult}
          />
        )}

        {mode === 'index_scan' && (
          <>
            <IndexScanPanel
              scan={activeScan}
              ranking={scanRanking}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              onOpenSymbol={openIndexScanSymbol}
            />
            {pastScans.length > 0 && (
              <div className="mb-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Past Scans</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Index', 'Exchange', 'Interval', 'Range', 'Status', 'Created', ''].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastScans.map(s => (
                      <tr key={s.id} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${activeScan?.id === s.id ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''}`}>
                        <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{s.index}</td>
                        <td className="px-3 py-2 text-zinc-500">{s.exchange}</td>
                        <td className="px-3 py-2 text-zinc-500">{s.interval}</td>
                        <td className="px-3 py-2 text-zinc-500">{s.from_date} → {s.to_date}</td>
                        <td className="px-3 py-2 text-zinc-500">{s.status} ({s.completed_symbols}/{s.total_symbols})</td>
                        <td className="px-3 py-2 text-zinc-500">{s.created_at.slice(0, 16).replace('T', ' ')}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => openPastScan(s)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                            Open →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {mode === 'symbol_sweep' && (
          <>
            <SymbolSweepPanel sweep={activeSweep} />
            <SymbolComparisonView
              result={compareResult} loading={false} error={null}
              onOpenResult={openComparisonResult}
            />
          </>
        )}

        {mode !== 'rsi_live' && mode !== 'index_scan' && mode !== 'symbol_sweep' && mode !== 'live_backtest' && (
        <>
        {msg && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {msg.text}
          </div>
        )}

        {/* Active run status */}
        {activeRun && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {activeRun.symbol} · {activeRun.exchange} · {activeRun.interval}
              </p>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                activeRun.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : activeRun.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              }`}>
                {activeRun.status}
              </span>
            </div>
            {ACTIVE_STATUSES.has(activeRun.status) && (
              <div className="mt-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {activeRun.completed_candidates}/{activeRun.total_candidates || '…'} strategies backtested
                </p>
              </div>
            )}
            {activeRun.status === 'failed' && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{activeRun.error}</p>
            )}
          </div>
        )}

        {/* Ranked results */}
        {results && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Ranked Strategies ({results.length})
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className="px-3 py-2 text-left font-medium text-zinc-400">#</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-400">Strategy</th>
                    <SortTh label="Score" k="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="CAGR" k="cagr" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Sharpe" k="sharpe" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Max DD" k="max_dd" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Win Rate" k="win_rate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="PF" k="pf" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Trades" k="trades" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Stability" k="stability" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sortResults(results, sortKey, sortDir).map((r, i) => (
                    <tr key={r.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                      <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-50">{r.candidate.name}</p>
                        <p className="text-[10px] text-zinc-400">{r.candidate.family}</p>
                      </td>
                      <td className="px-3 py-2 font-bold text-indigo-600 dark:text-indigo-400">{r.composite_score.toFixed(1)}</td>
                      <td className={`px-3 py-2 font-mono ${r.full_metrics.cagr_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {r.full_metrics.cagr_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{r.full_metrics.sharpe_ratio.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-red-500">{r.full_metrics.max_drawdown_pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{r.full_metrics.win_rate_pct.toFixed(0)}%</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{r.full_metrics.profit_factor.toFixed(2)}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.full_metrics.total_trades}</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{r.walk_forward.stability_score.toFixed(0)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => openDetail(r.id)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                          Details →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detail panel */}
        {(detailLoading || detail) && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            {detailLoading || !detail ? (
              <p className="py-8 text-center text-xs text-zinc-400">Loading…</p>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{detail.candidate.name}</p>
                    <p className="text-[11px] text-zinc-400">{detail.candidate.description}</p>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-xs text-zinc-400 hover:text-zinc-600">Close ✕</button>
                </div>

                <MetricsGrid m={detail.full_metrics} />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Equity Curve</p>
                    <LineChart
                      points={detail.equity_curve.map((p, i) => ({ x: i, y: p.equity }))}
                      color="#4f46e5"
                      formatY={v => `₹${(v / 1000).toFixed(0)}k`}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Drawdown</p>
                    <LineChart
                      points={detail.drawdown_curve.map((p, i) => ({ x: i, y: -p.drawdown_pct }))}
                      color="#ef4444"
                      formatY={v => `${v.toFixed(0)}%`}
                    />
                  </div>
                </div>

                <div className="mt-5">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Walk-Forward: Train (first 70%) vs Test (last 30%, out-of-sample)
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                      <p className="mb-2 text-[10px] font-bold text-zinc-500">TRAIN</p>
                      <MetricsGrid m={detail.walk_forward.train_metrics} />
                    </div>
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                      <p className="mb-2 text-[10px] font-bold text-zinc-500">TEST (out-of-sample)</p>
                      <MetricsGrid m={detail.walk_forward.test_metrics} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Stability score: <span className="font-bold text-zinc-900 dark:text-zinc-50">{detail.walk_forward.stability_score.toFixed(0)}/100</span>
                  </p>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      Monte Carlo Simulation
                    </p>
                    <button
                      onClick={runMonteCarlo}
                      disabled={monteCarloLoading || detail.trades.length < 10}
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {monteCarloLoading ? 'Simulating…' : monteCarlo ? 'Re-run (2,000 sims)' : 'Run 2,000 Simulations'}
                    </button>
                  </div>
                  {detail.trades.length < 10 ? (
                    <p className="text-xs text-zinc-400">Needs at least 10 trades to be meaningful (this result has {detail.trades.length}).</p>
                  ) : monteCarloError ? (
                    <p className="text-xs text-red-500">{monteCarloError}</p>
                  ) : monteCarlo ? (
                    <>
                      <p className="mb-3 text-[11px] text-zinc-400">
                        Bootstrap-resamples this result&apos;s own {monteCarlo.trades_per_simulation} trade returns
                        {monteCarlo.num_simulations.toLocaleString('en-IN')} times, compounding each draw the same
                        way the backtest&apos;s own risk-based sizing would — the historical run above is just one
                        draw from this distribution, not the expected outcome.
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Metric label="Net P&L (5th pct)" value={`${monteCarlo.net_pnl_pct_p5 >= 0 ? '+' : ''}${monteCarlo.net_pnl_pct_p5.toFixed(1)}%`} accent={monteCarlo.net_pnl_pct_p5 >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                        <Metric label="Net P&L (median)" value={`${monteCarlo.net_pnl_pct_p50 >= 0 ? '+' : ''}${monteCarlo.net_pnl_pct_p50.toFixed(1)}%`} accent={monteCarlo.net_pnl_pct_p50 >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                        <Metric label="Net P&L (95th pct)" value={`${monteCarlo.net_pnl_pct_p95 >= 0 ? '+' : ''}${monteCarlo.net_pnl_pct_p95.toFixed(1)}%`} accent={monteCarlo.net_pnl_pct_p95 >= 0 ? 'text-emerald-600' : 'text-red-500'} />
                        <Metric label="Final Equity (median)" value={`₹${monteCarlo.final_equity_p50.toLocaleString('en-IN')}`} />
                        <Metric label="Max DD (median)" value={`${monteCarlo.max_drawdown_pct_p50.toFixed(1)}%`} accent="text-red-500" />
                        <Metric label="Max DD (95th pct, worse case)" value={`${monteCarlo.max_drawdown_pct_p95.toFixed(1)}%`} accent="text-red-500" />
                        <Metric label="P(loss)" value={`${monteCarlo.probability_of_loss_pct.toFixed(1)}%`} />
                        <Metric label="P(ruin, equity ≤ 50%)" value={`${monteCarlo.probability_of_ruin_pct.toFixed(1)}%`} accent={monteCarlo.probability_of_ruin_pct > 5 ? 'text-red-500' : undefined} />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-zinc-400">Not run yet — click the button above.</p>
                  )}
                </div>

                <div className="mt-5">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Trades ({detail.trades.length})
                  </p>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          {['Entry', 'Exit', 'Entry ₹', 'Exit ₹', 'Qty', 'P&L', 'P&L %', 'Reason'].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left font-medium text-zinc-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.trades.map((t, i) => (
                          <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                            <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-300">{t.entry_time.slice(0, 16).replace('T', ' ')}</td>
                            <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-300">{t.exit_time.slice(0, 16).replace('T', ' ')}</td>
                            <td className="px-2 py-1.5 font-mono">{t.entry_price.toFixed(2)}</td>
                            <td className="px-2 py-1.5 font-mono">{t.exit_price.toFixed(2)}</td>
                            <td className="px-2 py-1.5">{t.quantity}</td>
                            <td className={`px-2 py-1.5 font-mono font-semibold ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{t.pnl.toFixed(0)}</td>
                            <td className={`px-2 py-1.5 font-mono ${t.pnl_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{t.pnl_pct.toFixed(1)}%</td>
                            <td className="px-2 py-1.5 text-zinc-500">{t.exit_reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Past runs */}
        {runs.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Past Runs</p>
              <p className="text-[11px] text-zinc-400">
                {runsTotal === 0 ? '0 of 0' : `${runsPage * PAST_RUNS_PAGE_SIZE + 1}–${Math.min((runsPage + 1) * PAST_RUNS_PAGE_SIZE, runsTotal)} of ${runsTotal}`}
              </p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <RunSortTh label="Symbol" field="symbol" sortBy={runsSortBy} sortDir={runsSortDir} onSort={handleRunsSort} />
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Exchange</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Interval</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Range</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Best Strategy</th>
                  <RunSortTh label="Score" field="score" sortBy={runsSortBy} sortDir={runsSortDir} onSort={handleRunsSort} />
                  <RunSortTh label="Status" field="status" sortBy={runsSortBy} sortDir={runsSortDir} onSort={handleRunsSort} />
                  <RunSortTh label="Created" field="created_at" sortBy={runsSortBy} sortDir={runsSortDir} onSort={handleRunsSort} />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.exchange}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.interval}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.from_date} → {r.to_date}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.best_candidate_name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                      {r.best_composite_score != null ? r.best_composite_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{r.status}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => openPastRun(r)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {runsTotal > PAST_RUNS_PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
                <button
                  onClick={() => loadRunsPage(runsPage - 1)}
                  disabled={runsLoading || runsPage === 0}
                  className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
                >
                  ← Previous
                </button>
                <span className="text-[11px] text-zinc-400">
                  Page {runsPage + 1} of {Math.ceil(runsTotal / PAST_RUNS_PAGE_SIZE)}
                </span>
                <button
                  onClick={() => loadRunsPage(runsPage + 1)}
                  disabled={runsLoading || (runsPage + 1) * PAST_RUNS_PAGE_SIZE >= runsTotal}
                  className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </main>
    </div>
  )
}

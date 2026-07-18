'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { RsiReversionLiveView } from '@/components/rsi-reversion-live'
import {
  startStrategyLabRun, startTrendPullbackRun, startOrbRun, startRsiReversionRun, startIndexScanRun,
  listStrategyLabRuns, getStrategyLabRun, listStrategyLabResults, getStrategyLabResult,
  listIndexScans, getIndexScan, getIndexScanRanking, listMcxContracts, searchStocks,
} from '@/lib/api'
import type {
  HistoricalDataInterval, StrategyLabRun, StrategyLabResultSummary, StrategyLabResultDetail,
  IndexScanRun, IndexScanRankingRow, McxContractOption, StockSearchResult, RunSortBy,
} from '@/lib/api'

const EXCHANGES = ['NSE', 'BSE', 'NFO', 'MCX']
const INTERVALS: HistoricalDataInterval[] = [
  'minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day',
]
const ACTIVE_STATUSES = new Set(['pending', 'downloading', 'generating', 'running'])
const ACTIVE_SCAN_STATUSES = new Set(['pending', 'running'])
const INDEX_OPTIONS = [{ id: 'NIFTY50', label: 'NIFTY 50' }]

// 'rsi_live' isn't a backtest run at all -- it's the same live-monitoring
// view as the MCX page's "RSI Strategy" tab (see RsiReversionLiveView),
// surfaced here too since this is where the strategy was actually
// discovered and validated (see the AI Strategy Lab conversation history:
// #1 ranked of 392 candidates for Natural Gas Mini). 'index_scan' runs the
// full generated sweep against every symbol in an index (see
// strategy_lab_service.start_index_scan_run) instead of a single symbol.
type Mode = 'generated' | 'trend_pullback' | 'orb' | 'rsi_reversion' | 'index_scan' | 'rsi_live'

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

// ── Main view ─────────────────────────────────────────────────────────────

export default function StrategyLabView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)

  const [mode, setMode] = useState<Mode>('generated')
  const [trendPullbackVersion, setTrendPullbackVersion] = useState<'v1.0' | 'v2.0'>('v2.0')
  const [rsiReversionVersion, setRsiReversionVersion] = useState<'v1.0' | 'v2.0'>('v1.0')
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

  const [indexScanIndex, setIndexScanIndex] = useState('NIFTY50')
  const [activeScan, setActiveScan] = useState<IndexScanRun | null>(null)
  const [scanRanking, setScanRanking] = useState<IndexScanRankingRow[] | null>(null)
  const [pastScans, setPastScans] = useState<IndexScanRun[]>([])
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    return () => clearTimeout(id)
  }, [router])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => {
    return () => { if (scanPollRef.current) clearInterval(scanPollRef.current) }
  }, [])

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

  function handleModeChange(next: Mode) {
    setMode(next)
    setMsg(null)
    if (next === 'trend_pullback' || next === 'rsi_reversion') {
      // MCX futures roll monthly and Kite only lists the current contract,
      // so a long lookback isn't achievable -- default to a realistic window.
      setFromDate(daysAgoStr(180))
    } else {
      setFromDate(daysAgoStr(next === 'orb' ? 90 : 730))
    }
    if (next === 'orb' && interval === 'day') setIntervalOption('5minute')
    if (next === 'index_scan') setExchange('NSE')
  }

  async function handleStart() {
    if (mode !== 'index_scan' && !symbol) return
    setStarting(true); setMsg(null); setResults(null); setDetail(null)
    try {
      if (mode === 'index_scan') {
        setActiveScan(null); setScanRanking(null)
        const { scan_id } = await startIndexScanRun(tokenRef.current, {
          index: indexScanIndex, exchange, interval, from_date: fromDate, to_date: toDate, capital,
        })
        const scan = await getIndexScan(tokenRef.current, scan_id)
        setActiveScan(scan)
        watchScan(scan_id)
        listIndexScans(tokenRef.current).then(setPastScans).catch(() => {})
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
    try {
      const d = await getStrategyLabResult(tokenRef.current, activeRun.id, resultId)
      setDetail(d)
    } catch { /* ignore */ } finally { setDetailLoading(false) }
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

          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => handleModeChange('generated')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'generated' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Generate &amp; Backtest (auto)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('trend_pullback')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'trend_pullback' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Trend Pullback (hand-designed)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('orb')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'orb' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Opening Range Breakout
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('rsi_reversion')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'rsi_reversion' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              RSI Reversion (Backtest)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('index_scan')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'index_scan' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              Index Scan
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('rsi_live')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'rsi_live' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              RSI Reversion (Live)
            </button>
          </div>

          {mode === 'rsi_live' && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Not a backtest run — this is the same live monitoring view as the MCX page&apos;s &quot;RSI Strategy&quot;
              tab, fixed to Natural Gas Mini (the only contract this strategy is validated for). See below.
            </p>
          )}

          {mode !== 'rsi_live' && (
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
              <div className="mb-2 flex gap-2">
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
                  v2.0 (adds short leg — untested)
                </button>
              </div>
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                {rsiReversionVersion === 'v1.0' ? (
                  <>Long-only: buy when RSI-14 drops below 20 (oversold), while flat. Stop: entry − 2.5%, trailing up
                  to close × (1 − 2.0%) once favorable. Target: entry + 5.0%. Exits early if RSI climbs back above
                  80. This is the exact logic already deployed live for Natural Gas Mini (see the MCX page&apos;s RSI
                  Strategy tab) — the baseline to compare v2.0 against.</>
                ) : (
                  <>Adds a short leg, a symmetric mirror of the long side: short when RSI rises above 80 while flat,
                  cover on the mirrored stop/trailing-stop/target, or early if RSI drops back below 20. This is
                  <strong> not yet validated</strong> — run it and check whether P&amp;L improves and drawdown stays
                  flat-or-better vs v1.0, and always check the walk-forward split (train vs test) below before
                  trusting a full-period number alone.</>
                )}
              </p>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Exchange</label>
              {mode === 'index_scan' ? (
                <div className="flex h-[30px] w-full items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
                  NSE (fixed)
                </div>
              ) : (
                <select value={exchange} onChange={e => handleExchangeChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  {EXCHANGES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
            </div>
            {mode !== 'trend_pullback' && mode !== 'rsi_reversion' ? (
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
          </div>

          {mode === 'index_scan' ? (
            <>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Index</label>
              <select value={indexScanIndex} onChange={e => setIndexScanIndex(e.target.value)}
                className="mb-3 w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                {INDEX_OPTIONS.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Runs the full 392-candidate sweep on every constituent (50 for NIFTY 50) sequentially, one full
                symbol run at a time — this can take a while (candle download + ~400 backtests per symbol). Progress
                and a live leaderboard appear below once started; you can navigate away and come back.
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
          </>
          )}

          <label className="mb-1 block text-xs font-medium text-zinc-500">Capital (₹)</label>
          <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))} min={1000} step={1000}
            className="mb-4 w-full max-w-[200px] rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />

          <div>
            <button
              onClick={handleStart}
              disabled={starting || (mode !== 'index_scan' && !symbol) || (activeRun !== null && ACTIVE_STATUSES.has(activeRun.status)) || (activeScan !== null && ACTIVE_SCAN_STATUSES.has(activeScan.status))}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {starting ? 'Starting…' : mode === 'trend_pullback' ? 'Run Trend Pullback Backtest' : mode === 'orb' ? 'Run Opening Range Breakout Backtest' : mode === 'rsi_reversion' ? `Run RSI Reversion ${rsiReversionVersion} Backtest` : mode === 'index_scan' ? `Scan ${INDEX_OPTIONS.find(i => i.id === indexScanIndex)?.label ?? indexScanIndex}` : 'Generate & Backtest'}
            </button>
          </div>
          </>
          )}
        </div>

        {mode === 'rsi_live' && <RsiReversionLiveView />}

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

        {mode !== 'rsi_live' && mode !== 'index_scan' && (
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

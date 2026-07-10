'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import type { AILevels, RefLine, PredictionPoint } from '@/components/price-chart'
import {
  getNgQuote, listNgTrades, placeNgTrade, closeNgTrade, getBrokerStatus, getNgAiScore, getNgHistory, getNgTrend, getNgRangeStats, getNgPrediction, getNgPredictionArchive, getNgDashboardHistory, getNgSignals, getNgGlobalSymbols, getNgGlobalSymbolsHistory, getNgNews, getMe, ApiError,
} from '@/lib/api'
import type {
  NgQuote, McxTrade, BrokerStatus, NgAiScore, HistoryBar, ChartPeriod, McxContract, NgTrendLadder, TrendTimeframe, NgRangeStats, NgPrediction, NgPredictionHistoryPoint, NgPredictionAccuracy, PredictionPeriod, NgDashboardSnapshot, NgSignalsResponse, NgGlobalSymbolRow, NgGlobalSymbolSnapshot, NgSessionOpenReference, NgNewsResponse,
} from '@/lib/api'

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }
function pnlColor(v: number) { return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-500' }

type Tab = 'dashboard' | 'chart' | 'trend' | 'ai' | 'trade' | 'portfolio'

const CONTRACTS: { id: McxContract; label: string }[] = [
  { id: 'NG', label: 'Natural Gas' },
  { id: 'NGMINI', label: 'Natural Gas Mini' },
]

type TradePrefill = { signal: 'BUY' | 'SELL'; lots: number; stopLoss: number; target: number }

// ── NG Dashboard ─────────────────────────────────────────────────────────────

function NgChart({ quote, score, contract, period, onPeriodChange }: {
  quote: NgQuote | null
  score: NgAiScore | null
  contract: McxContract
  period: ChartPeriod
  onPeriodChange: (p: ChartPeriod) => void
}) {
  const [bars, setBars] = useState<HistoryBar[]>([])
  const [loading, setLoading] = useState(true)
  const [rangeStats, setRangeStats] = useState<NgRangeStats | null>(null)
  const [prediction, setPrediction] = useState<NgPrediction | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true)
    let first = true
    function load() {
      getNgHistory(t, period, contract)
        .then(setBars)
        .catch(() => { if (first) setBars([]) })
        .finally(() => { setLoading(false); first = false })
    }
    load()
    // Re-fetch periodically (not just on period/contract change) so the
    // chart's real data stays in sync with the locally live-extended last
    // candle -- otherwise the visible-range centering (anchored to this
    // fetch) and the LTP ball (which follows the live-rolled-forward bar)
    // drift apart the longer a tab stays open, and the ball ends up
    // positioned outside what's actually shown.
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [period, contract])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgRangeStats(t, contract).then(setRangeStats).catch(() => {})
    }
    load()
    const id = setInterval(load, 120_000)
    return () => clearInterval(id)
  }, [contract])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgPrediction(t, contract, period).then(setPrediction).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [contract, period])

  const aiLevels: AILevels = score
    ? {
        signal: score.verdict === 'NO_TRADE' ? 'HOLD' : score.direction,
        entry: score.entry.entry_price,
        stopLoss: score.entry.stop_loss,
        target: score.entry.target_1,
      }
    : null

  const refLines: RefLine[] = rangeStats
    ? [
        { price: rangeStats.day_high, label: 'DH1' },
        { price: rangeStats.week_high, label: 'DH2' },
        { price: rangeStats.month_high, label: 'DH3' },
        { price: rangeStats.day_low, label: 'DL1' },
        { price: rangeStats.week_low, label: 'DL2' },
        { price: rangeStats.month_low, label: 'DL3' },
      ]
    : []

  // Merge the persisted trail (past predictions, which stay on the chart
  // even once their time has elapsed) with the current forward forecast,
  // de-duplicated by time and sorted ascending -- lightweight-charts
  // requires strictly ordered, unique points per line series.
  const predictionPoints: PredictionPoint[] = prediction
    ? Array.from(
        [...prediction.history, ...prediction.predicted]
          .reduce((map, p) => {
            map.set(p.time, { time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower })
            return map
          }, new Map<number, PredictionPoint>())
          .values(),
      ).sort((a, b) => a.time - b.time)
    : []

  const acc = prediction?.accuracy

  return (
    <div className="space-y-2">
      <PriceChart
        symbol={quote?.tradingsymbol ?? 'MCX Natural Gas'}
        data={bars}
        period={period}
        onPeriodChange={onPeriodChange}
        loading={loading}
        aiLevels={aiLevels}
        currentPrice={quote?.last_price ?? null}
        exchangeLabel="MCX"
        refLines={refLines}
        prediction={predictionPoints}
      />
      {prediction?.note ? (
        <p className="text-[11px] text-zinc-400">{prediction.note}</p>
      ) : prediction && (
        <p className="text-[11px] text-zinc-400">
          Purple line is the AI prediction ({period} horizon, local heuristic — not a trading signal on its own).
          {acc && acc.sample_size > 0 ? (
            <> Tracked {acc.sample_size} past predictions &middot; <span className="font-semibold text-zinc-600 dark:text-zinc-300">{acc.hit_rate_pct?.toFixed(1)}%</span> landed within band &middot; avg error {acc.avg_error_pct?.toFixed(2)}%.</>
          ) : (
            ' Accuracy tracking builds up as time passes each predicted candle.'
          )}
        </p>
      )}
    </div>
  )
}

// Each intraday granularity gets its own single-group table (display order:
// Hours, 30 Mins, 15 Mins, then Minutes split into two half-day tables --
// see MinuteAccuracyTables) rather than one wide multi-group table, since a
// full day of 1-minute rows alone would otherwise dominate the page.
const HOURS_GROUP: { label: string; period: PredictionPeriod }[] = [{ label: 'Hours', period: '1h' }]
const THIRTY_MIN_GROUP: { label: string; period: PredictionPeriod }[] = [{ label: '30 Mins', period: '30m' }]
const FIFTEEN_MIN_GROUP: { label: string; period: PredictionPeriod }[] = [{ label: '15 Mins', period: '15m' }]
// Combined 4-group layout for the (collapsed-by-default) archive view --
// a compact past-day summary doesn't need the same one-table-per-granularity
// split as the live "today" view.
const ALL_INTRADAY_GROUPS: { label: string; period: PredictionPeriod }[] = [
  { label: 'Hours', period: '1h' },
  { label: '30 Mins', period: '30m' },
  { label: '15 Mins', period: '15m' },
  { label: 'Minutes', period: '1m' },
]

// Bounds how far back resolved (actual-known) rows are shown -- the forward
// side (predicted-but-not-yet-happened) is intentionally NOT capped here,
// since the whole point is to prefill Time/Predicted for the rest of the
// day and let Actual/Accuracy fill in as real time passes each bucket (the
// backend's own MAX_HORIZON in mcx_prediction_service.py bounds how far
// forward predictions get generated in the first place).
const ACCURACY_MAX_PAST_ROWS = 25

type AccuracyRow = { time: number; actual: number | null; predicted: number; accuracyPct: number | null; isReference?: boolean }
type AccuracyData = {
  history: NgPredictionHistoryPoint[]
  predicted: { time: number; predicted_close: number }[]
  session_open_reference?: NgSessionOpenReference | null
}

function buildAccuracyRows(p: AccuracyData | undefined, minTime?: number, maxPastRows: number = ACCURACY_MAX_PAST_ROWS): AccuracyRow[] {
  if (!p) return []
  const byTime = new Map<number, { time: number; predicted_close: number; actual_close: number | null }>()
  for (const h of p.history) byTime.set(h.time, { time: h.time, predicted_close: h.predicted_close, actual_close: h.actual_close })
  for (const pt of p.predicted) {
    if (!byTime.has(pt.time)) byTime.set(pt.time, { time: pt.time, predicted_close: pt.predicted_close, actual_close: null })
  }
  // minTime scopes the "today" live table strictly to today's IST calendar
  // day -- without it, resolved rows could reach back into yesterday to pad
  // out to maxPastRows whenever today alone doesn't have enough yet (e.g.
  // early in the trading session). maxPastRows itself is only meant to keep
  // the live "today" table from growing unbounded as the day goes on --
  // frozen archive/weekly views pass Infinity to show the whole day.
  let all = Array.from(byTime.values()).sort((a, b) => a.time - b.time)
  if (minTime != null) all = all.filter(r => r.time >= minTime)
  const resolved = all.filter(r => r.actual_close != null).slice(-maxPastRows)
  const pending = all.filter(r => r.actual_close == null)
  const rows: AccuracyRow[] = [...resolved, ...pending]
    .sort((a, b) => a.time - b.time)
    .map(r => ({
      time: r.time,
      actual: r.actual_close,
      predicted: r.predicted_close,
      accuracyPct: r.actual_close != null ? Math.max(0, 100 - (Math.abs(r.actual_close - r.predicted_close) / r.actual_close) * 100) : null,
    }))
  // "Hours" only: its first genuinely predictable bucket is an hour after
  // session open (the current hour itself is real data, not a forecast),
  // which otherwise makes it look like it starts later than every other
  // column -- this reference row (real price, not a prediction) fills that.
  const ref = p.session_open_reference
  if (ref && !rows.some(r => r.time === ref.time)) {
    rows.unshift({ time: ref.time, actual: ref.price, predicted: ref.price, accuracyPct: null, isReference: true })
  }
  return rows
}

function fmtPredictionTime(t: number): string {
  // Force IST regardless of the browser/OS's ambient timezone -- this is an
  // India-only market, and without an explicit timeZone here the value
  // silently renders in whatever zone the browser happens to be set to
  // (e.g. showing an afternoon time when it's actually 20:23 IST).
  return new Date(t * 1000).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

function fmtPredictionDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

// Mirrors backend PERIOD_BUCKET_SECONDS (mcx_prediction_service.py) for just
// the periods these live accuracy tables actually render.
const PREDICTION_BUCKET_SECONDS: Partial<Record<PredictionPeriod, number>> = {
  '1m': 60, '15m': 900, '30m': 1800, '1h': 3600,
}

// The row a table should highlight as "current" -- the smallest bucket-grid
// point (anchored to today's 09:00 IST session open, same grid the backend
// snaps predictions to) that is >= now. E.g. at 13:26 IST this is 13:26 for
// the 1-minute grid, 13:30 for 15/30-minute grids, and 14:00 for the hourly
// grid (i.e. the row representing the 13:00-14:00 hour). Rows from a
// different calendar day never match, so this is a no-op on archived/past
// tables without needing a separate flag.
function currentBucketBoundary(period: PredictionPeriod, nowEpoch: number): number | null {
  const bucket = PREDICTION_BUCKET_SECONDS[period]
  if (!bucket) return null
  const sessionOpen = istDayStartEpoch(istDateStr(0)) + 9 * 3600
  const elapsed = nowEpoch - sessionOpen
  if (elapsed < 0) return sessionOpen
  const gridFloor = sessionOpen + Math.floor(elapsed / bucket) * bucket
  return gridFloor === nowEpoch ? gridFloor : gridFloor + bucket
}

function accuracyColor(pct: number): string {
  return pct >= 95 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'
}

// IST calendar date as "YYYY-MM-DD", `daysAgo` days before today.
function istDateStr(daysAgo: number): string {
  const now = new Date()
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  istNow.setDate(istNow.getDate() - daysAgo)
  const y = istNow.getFullYear()
  const m = String(istNow.getMonth() + 1).padStart(2, '0')
  const d = String(istNow.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fmtDateStrDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Epoch seconds for 00:00 IST of a "YYYY-MM-DD" date -- 00:00 IST is 18:30
// UTC of the *previous* calendar day (IST = UTC+5:30).
function istDayStartEpoch(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - 5.5 * 3600 * 1000) / 1000)
}

// Monday of the ISO week containing "YYYY-MM-DD".
function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

// Monday through Friday of the week starting at `mondayStr`.
function weekdayDates(mondayStr: string): string[] {
  const [y, m, d] = mondayStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  return Array.from({ length: 5 }, (_, i) => {
    const dt = new Date(base)
    dt.setUTCDate(base.getUTCDate() + i)
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  })
}

// Weekdays (Mon-Fri) from the 1st of the month through `todayStr`, inclusive.
function weekdaysInMonthToDate(todayStr: string): string[] {
  const [y, m, d] = todayStr.split('-').map(Number)
  const dates: string[] = []
  const cursor = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m - 1, d))
  while (cursor <= end) {
    const dow = cursor.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      dates.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function CollapsibleCard({ title, subtitle, defaultOpen, children }: {
  title: string
  subtitle?: ReactNode
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
            className={cls('text-zinc-400 transition-transform', open ? 'rotate-90' : '')}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</span>
        </span>
        {subtitle}
      </button>
      {open && <div className="border-t border-zinc-100 dark:border-zinc-800">{children}</div>}
    </div>
  )
}

function LiveDot({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  )
}

function AccuracyTrailGrid({ groups, rowsByGroup, showDate }: {
  groups: { label: string; period: PredictionPeriod }[]
  rowsByGroup: AccuracyRow[][]
  showDate?: boolean
}) {
  const maxRows = Math.max(0, ...rowsByGroup.map(r => r.length))
  const fmtTime = showDate ? (t: number) => `${fmtPredictionDate(t)} ${fmtPredictionTime(t)}` : fmtPredictionTime

  // Ticks every 20s so the highlighted "current" row advances on its own
  // without needing a full data refetch.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 20_000)
    return () => clearInterval(id)
  }, [])
  const currentBoundaries = groups.map(g => currentBucketBoundary(g.period, now))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          {groups.length > 1 && (
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {groups.map((g, gi) => (
                <th
                  key={g.period}
                  colSpan={4}
                  className={cls('px-3 py-1.5 text-center font-semibold text-zinc-600 dark:text-zinc-300', gi > 0 && 'border-l border-zinc-200 dark:border-zinc-700')}
                >
                  {g.label}
                </th>
              ))}
            </tr>
          )}
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            {groups.map((g, gi) => (
              ['Time', 'Actual', 'Predicted', 'Accuracy'].map((h, hi) => (
                <th
                  key={`${g.period}-${h}`}
                  className={cls('px-3 py-2 text-left font-medium text-zinc-500', gi > 0 && hi === 0 && 'border-l border-zinc-200 dark:border-zinc-700')}
                >
                  {h}
                </th>
              ))
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
          {maxRows === 0 ? (
            <tr>
              <td colSpan={groups.length * 4} className="px-3 py-8 text-center text-zinc-400">
                No predictions yet — builds up once there's enough candle history.
              </td>
            </tr>
          ) : (
            Array.from({ length: maxRows }).map((_, i) => (
              <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                {rowsByGroup.map((rows, gi) => {
                  const r = rows[i]
                  const pending = r && r.actual == null
                  const isCurrent = !!r && r.time === currentBoundaries[gi]
                  const highlightCls = isCurrent && 'bg-cyan-50 dark:bg-cyan-950/40'
                  return (
                    <Fragment key={gi}>
                      <td className={cls('px-3 py-2 font-mono text-zinc-500', gi > 0 && 'border-l border-zinc-100 dark:border-zinc-800', highlightCls)} title={isCurrent ? 'Current time' : undefined}>
                        {r ? fmtTime(r.time) : ''}
                        {isCurrent && <span className="ml-1.5 rounded-full bg-cyan-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Now</span>}
                      </td>
                      <td className={cls('px-3 py-2 font-mono', highlightCls)}>
                        {r ? (pending ? <span className="italic text-zinc-400">pending</span> : `₹${r.actual?.toFixed(2)}`) : ''}
                      </td>
                      <td className={cls('px-3 py-2 font-mono', highlightCls)}>{r ? `₹${r.predicted.toFixed(2)}` : ''}</td>
                      <td className={cls('px-3 py-2 font-mono font-semibold', highlightCls)}>
                        {r ? (
                          r.isReference
                            ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">Session Open</span>
                            : pending
                              ? <span className="italic text-zinc-400">—</span>
                              : <span className={accuracyColor(r.accuracyPct as number)}>{(r.accuracyPct as number).toFixed(2)}%</span>
                        ) : ''}
                      </td>
                    </Fragment>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// Live (polling) trail table -- "today", or the week/month tables.
function LiveAccuracyTable({ title, groups, contract, defaultOpen, footnote, scopeToToday }: {
  title: string
  groups: { label: string; period: PredictionPeriod }[]
  contract: McxContract
  defaultOpen: boolean
  footnote: string
  scopeToToday?: boolean
}) {
  const [byPeriod, setByPeriod] = useState<Partial<Record<PredictionPeriod, NgPrediction>>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      Promise.allSettled(
        groups.map(g =>
          getNgPrediction(t, contract, g.period).then(p => setByPeriod(prev => ({ ...prev, [g.period]: p }))),
        ),
      ).then(() => setLastUpdated(new Date()))
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract])

  const minTime = scopeToToday ? istDayStartEpoch(istDateStr(0)) : undefined
  const rowsByGroup = groups.map(g => buildAccuracyRows(byPeriod[g.period], minTime))
  const notes = groups.map(g => byPeriod[g.period]?.note).filter(Boolean)
  const accSummaries = groups
    .map(g => ({ label: g.label, acc: byPeriod[g.period]?.accuracy }))
    .filter((x): x is { label: string; acc: NgPredictionAccuracy } =>
      !!x.acc && (x.acc.sample_size > 0 || !!x.acc.recalibrated_at),
    )

  return (
    <CollapsibleCard
      title={title}
      defaultOpen={defaultOpen}
      subtitle={<LiveDot label={lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Loading…'} />}
    >
      {notes.length > 0 && (
        <p className="px-4 py-3 text-xs text-amber-700 dark:text-amber-400">{notes[0]}</p>
      )}
      {accSummaries.length > 0 && (
        <div className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
          {accSummaries.map(({ label, acc }) => (
            <p key={label}>
              {groups.length > 1 ? `${label}: ` : ''}
              {acc.sample_size > 0 ? (
                <>
                  <span className="font-semibold text-zinc-600 dark:text-zinc-300">{acc.hit_rate_pct?.toFixed(1)}%</span> within band, avg error {acc.avg_error_pct?.toFixed(2)}% (last {acc.sample_size} resolved)
                </>
              ) : (
                <span className="italic">tracking since recalibration, no resolved buckets yet</span>
              )}
              {acc.recalibrated_at && (
                <span className="ml-1 rounded bg-cyan-100 px-1.5 py-0.5 font-medium text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400">
                  recalibrated {new Date(acc.recalibrated_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  {acc.recalibrated_from_pct != null ? ` — was ${acc.recalibrated_from_pct.toFixed(1)}%` : ''}
                  {acc.recalibrated_deviation_pct != null ? `, ${acc.recalibrated_deviation_pct.toFixed(2)}% deviation` : ''}
                </span>
              )}
            </p>
          ))}
        </div>
      )}
      <AccuracyTrailGrid groups={groups} rowsByGroup={rowsByGroup} />
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">{footnote}</p>
    </CollapsibleCard>
  )
}

// Frozen (fetch-once) trail table for a past IST calendar date -- lazily
// loaded only once the archive entry is expanded, since there's no point
// fetching every past day's data up front for a row that stays collapsed.
function ArchivedAccuracyTable({ dateStr, contract }: { dateStr: string; contract: McxContract }) {
  const [byPeriod, setByPeriod] = useState<Partial<Record<PredictionPeriod, AccuracyData>>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    Promise.allSettled(
      ALL_INTRADAY_GROUPS.map(g =>
        getNgPredictionArchive(t, contract, g.period, dateStr).then(a =>
          setByPeriod(prev => ({ ...prev, [g.period]: { history: a.history, predicted: [] } })),
        ),
      ),
    ).then(() => setLoaded(true))
  }, [dateStr, contract])

  const rowsByGroup = ALL_INTRADAY_GROUPS.map(g => buildAccuracyRows(byPeriod[g.period], undefined, Infinity))

  if (!loaded) return <div className="h-24 animate-pulse bg-zinc-50 dark:bg-zinc-800/40" />
  return <AccuracyTrailGrid groups={ALL_INTRADAY_GROUPS} rowsByGroup={rowsByGroup} />
}

function PredictionArchiveBrowser({ contract }: { contract: McxContract }) {
  const pastDays = Array.from({ length: 6 }, (_, i) => istDateStr(i + 1))
  return (
    <div className="space-y-2">
      {pastDays.map(dateStr => (
        <CollapsibleCard key={dateStr} title={`AI Prediction Accuracy Trail — ${fmtDateStrDisplay(dateStr)}`} defaultOpen={false}>
          <ArchivedAccuracyTable dateStr={dateStr} contract={contract} />
        </CollapsibleCard>
      ))}
    </div>
  )
}

// IST hour-of-day (0-23) for an epoch-seconds value -- used to split a full
// day of 1-minute rows into two half-day tables (see MinuteAccuracyTables).
function istHourOfDay(epochSeconds: number): number {
  const s = new Date(epochSeconds * 1000).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
  return parseInt(s, 10) % 24
}

// "Minutes" gets its own component (not LiveAccuracyTable) because a full
// day of 1-minute rows needs to be fetched ONCE and then split into two
// half-day tables client-side, rather than two independent fetches.
function MinuteAccuracyTables({ contract }: { contract: McxContract }) {
  const [data, setData] = useState<NgPrediction | undefined>(undefined)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgPrediction(t, contract, '1m').then(p => { setData(p); setLastUpdated(new Date()) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [contract])

  const allRows = buildAccuracyRows(data, istDayStartEpoch(istDateStr(0)))
  const amRows = allRows.filter(r => istHourOfDay(r.time) < 16)
  const pmRows = allRows.filter(r => istHourOfDay(r.time) >= 16)
  const amGroup = [{ label: 'Minutes (9 AM – 4 PM)', period: '1m' as PredictionPeriod }]
  const pmGroup = [{ label: 'Minutes (4 PM – 12 AM)', period: '1m' as PredictionPeriod }]
  const liveDot = <LiveDot label={lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Loading…'} />
  const footnote = 'Split into two half-day tables since a full day of 1-minute rows is otherwise too long for one. Time and Predicted Price are prefilled ahead of time; Actual Price and Accuracy show "pending" until real time reaches that row.'

  return (
    <>
      <CollapsibleCard title="AI Prediction Accuracy Trail — 1 Minute (9:00 AM – 4:00 PM)" defaultOpen={false} subtitle={liveDot}>
        {data?.note && <p className="px-4 py-3 text-xs text-amber-700 dark:text-amber-400">{data.note}</p>}
        <AccuracyTrailGrid groups={amGroup} rowsByGroup={[amRows]} />
        <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">{footnote}</p>
      </CollapsibleCard>
      <CollapsibleCard title="AI Prediction Accuracy Trail — 1 Minute (4:00 PM – 12:00 AM)" defaultOpen={false} subtitle={liveDot}>
        <AccuracyTrailGrid groups={pmGroup} rowsByGroup={[pmRows]} />
        <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">{footnote}</p>
      </CollapsibleCard>
    </>
  )
}

// Shared by the Weekly and Monthly tables: same 15-minute Time/Actual/
// Predicted/Accuracy format as the daily "15 Mins" table, but spanning a
// caller-supplied list of weekdays instead of just today. Past days come
// from the (already-persisted) archive, full day, uncapped; today comes
// from the live feed; dates beyond today are simply skipped -- there's
// nothing to show for them without data leakage.
function DateRangeFifteenMinTable({ title, dates, contract, footnote }: {
  title: string
  dates: string[]
  contract: McxContract
  footnote: string
}) {
  const todayStr = istDateStr(0)
  const [rows, setRows] = useState<AccuracyRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    async function load() {
      const parts: AccuracyRow[] = []
      for (const dateStr of dates) {
        if (dateStr > todayStr) continue
        try {
          if (dateStr === todayStr) {
            const live = await getNgPrediction(t as string, contract, '15m')
            parts.push(...buildAccuracyRows(live, istDayStartEpoch(todayStr), Infinity))
          } else {
            const archived = await getNgPredictionArchive(t as string, contract, '15m', dateStr)
            parts.push(...buildAccuracyRows({ history: archived.history, predicted: [] }, undefined, Infinity))
          }
        } catch {
          // one day failing to load shouldn't blank out the rest of the range
        }
      }
      parts.sort((a, b) => a.time - b.time)
      setRows(parts)
      setLoaded(true)
      setLastUpdated(new Date())
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, dates.join(','), todayStr])

  const group = [{ label: '15 Mins', period: '15m' as PredictionPeriod }]

  return (
    <CollapsibleCard
      title={title}
      defaultOpen={false}
      subtitle={<LiveDot label={lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Loading…'} />}
    >
      {!loaded ? (
        <div className="h-24 animate-pulse bg-zinc-50 dark:bg-zinc-800/40" />
      ) : (
        <AccuracyTrailGrid groups={group} rowsByGroup={[rows]} showDate />
      )}
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">{footnote}</p>
    </CollapsibleCard>
  )
}

function PredictionAccuracyTable({ contract }: { contract: McxContract }) {
  return (
    <div className="space-y-3">
      <LiveAccuracyTable
        title="AI Prediction Accuracy Trail — Hours"
        groups={HOURS_GROUP}
        contract={contract}
        defaultOpen
        scopeToToday
        footnote={'Time and Predicted Price are prefilled through the rest of the day as soon as they’re generated; Actual Price and Accuracy show "pending" until real time reaches that row, then fill in automatically. First row is the real session-open price, not a prediction.'}
      />
      <LiveAccuracyTable
        title="AI Prediction Accuracy Trail — 30 Mins"
        groups={THIRTY_MIN_GROUP}
        contract={contract}
        defaultOpen
        scopeToToday
        footnote={'Time and Predicted Price are prefilled through the rest of the day as soon as they’re generated; Actual Price and Accuracy show "pending" until real time reaches that row, then fill in automatically. First row is the real session-open price, not a prediction.'}
      />
      <LiveAccuracyTable
        title="AI Prediction Accuracy Trail — 15 Mins"
        groups={FIFTEEN_MIN_GROUP}
        contract={contract}
        defaultOpen
        scopeToToday
        footnote={'Time and Predicted Price are prefilled through the rest of the day as soon as they’re generated; Actual Price and Accuracy show "pending" until real time reaches that row, then fill in automatically. First row is the real session-open price, not a prediction.'}
      />
      <MinuteAccuracyTables contract={contract} />
      <DateRangeFifteenMinTable
        title="AI Prediction Accuracy Trail — Weekly (15 Mins, Mon–Fri)"
        dates={weekdayDates(mondayOfWeek(istDateStr(0)))}
        contract={contract}
        footnote="Same 15-minute grid as the daily table, spanning this week (Monday–Friday) instead of just today. Weekdays that haven't happened yet won't have rows; each day starts with its own real session-open reference row."
      />
      <DateRangeFifteenMinTable
        title="AI Prediction Accuracy Trail — Monthly (15 Mins, weekdays)"
        dates={weekdaysInMonthToDate(istDateStr(0))}
        contract={contract}
        footnote="Same 15-minute grid as the daily table, spanning this calendar month's weekdays (1st through today). Days that haven't happened yet won't have rows; each day starts with its own real session-open reference row."
      />
      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Previous Days (Archive)</p>
        <PredictionArchiveBrowser contract={contract} />
      </div>
    </div>
  )
}

function BuySellScale({ buy, sell }: { buy: NgAiScore | null; sell: NgAiScore | null }) {
  if (!buy || !sell) {
    return <div className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
  }
  const buyPct = Math.min(100, buy.score_pct)
  const sellPct = Math.min(100, sell.score_pct)
  const diff = buyPct - sellPct
  const lean = diff > 8 ? 'BUY' : diff < -8 ? 'SELL' : 'BALANCED'
  const leanStyle = lean === 'BUY' ? 'bg-emerald-600 text-white' : lean === 'SELL' ? 'bg-red-500 text-white' : 'bg-zinc-400 text-white'
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Live Buy / Sell Weight Scale</p>
        <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', leanStyle)}>
          {lean === 'BALANCED' ? 'BALANCED' : `LEANING ${lean}`} ({diff >= 0 ? '+' : ''}{diff.toFixed(1)})
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-14 text-right font-mono text-lg font-bold text-red-500">{sellPct.toFixed(1)}</span>
        <div className="relative flex h-4 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-zinc-300 dark:bg-zinc-600" />
          <div className="flex h-full w-1/2 justify-end">
            <div className="h-full rounded-l-full bg-gradient-to-l from-red-500 to-red-400 transition-all duration-700" style={{ width: `${sellPct}%` }} />
          </div>
          <div className="flex h-full w-1/2 justify-start">
            <div className="h-full rounded-r-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700" style={{ width: `${buyPct}%` }} />
          </div>
        </div>
        <span className="w-14 font-mono text-lg font-bold text-emerald-600">{buyPct.toFixed(1)}</span>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
        <span>SELL &middot; {sell.verdict}</span>
        <span>BUY &middot; {buy.verdict}</span>
      </div>
    </div>
  )
}

function NgWatchlist({ contract }: { contract: McxContract }) {
  const [quotes, setQuotes] = useState<Partial<Record<McxContract, NgQuote>>>({})

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      for (const c of CONTRACTS) {
        getNgQuote(t, c.id).then(q => setQuotes(prev => ({ ...prev, [c.id]: q }))).catch(() => {})
      }
    }
    load()
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Watchlist &middot; Live</p>
      <div className="space-y-2">
        {CONTRACTS.map(c => {
          const q = quotes[c.id]
          return (
            <div
              key={c.id}
              className={cls(
                'flex items-center justify-between rounded-lg px-3 py-2',
                contract === c.id ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-zinc-50 dark:bg-zinc-800/40',
              )}
            >
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{c.label}</p>
                <p className="text-[11px] text-zinc-400">{q?.tradingsymbol ?? '—'}</p>
              </div>
              {q ? (
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-50">₹{q.last_price.toFixed(2)}</p>
                  <p className={cls('font-mono text-xs font-semibold', pnlColor(q.change))}>
                    {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)
                  </p>
                </div>
              ) : (
                <span className="text-xs text-zinc-400">Loading…</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type HistoryRow = {
  key: string
  last_price: number
  open: number
  high: number
  low: number
  volume: number
  oi: number
  buy_score_pct: number
  sell_score_pct: number
}

// ISO-week (Monday) key in IST, from a "YYYY-MM-DD" date string.
function istWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0 .. Sun=6
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - dow)
  return monday.toISOString().slice(0, 10)
}

function aggregateSnapshots(snapshots: NgDashboardSnapshot[], keyFn: (date: string) => string): HistoryRow[] {
  const groups = new Map<string, NgDashboardSnapshot[]>()
  for (const s of snapshots) {
    const k = keyFn(s.date)
    const arr = groups.get(k) ?? []
    arr.push(s)
    groups.set(k, arr)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
      const last = sorted[sorted.length - 1]
      return {
        key,
        last_price: last.last_price,
        open: sorted[0].open,
        high: Math.max(...sorted.map(s => s.high)),
        low: Math.min(...sorted.map(s => s.low)),
        volume: sorted.reduce((sum, s) => sum + s.volume, 0),
        oi: last.oi,
        buy_score_pct: last.buy_score_pct,
        sell_score_pct: last.sell_score_pct,
      }
    })
}

function NgDashboardHistoryTable({ title, rows, keyLabel, defaultOpen }: {
  title: string
  rows: HistoryRow[]
  keyLabel: string
  defaultOpen: boolean
}) {
  return (
    <CollapsibleCard title={title} defaultOpen={defaultOpen}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {[keyLabel, 'LTP', 'Open', 'High', 'Low', 'Volume', 'OI', 'Buy Score', 'Sell Score'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-400">
                  No snapshots yet — builds up once the daily snapshot job runs (near MCX close each trading day).
                </td>
              </tr>
            ) : (
              [...rows].reverse().map(r => (
                <tr key={r.key} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{r.key}</td>
                  <td className="px-3 py-2.5 font-mono">₹{r.last_price.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono">₹{r.open.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-emerald-600 dark:text-emerald-400">₹{r.high.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-red-500 dark:text-red-400">₹{r.low.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono">{r.volume.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 font-mono">{r.oi.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 font-mono text-emerald-600 dark:text-emerald-400">{r.buy_score_pct.toFixed(1)}</td>
                  <td className="px-3 py-2.5 font-mono text-red-500 dark:text-red-400">{r.sell_score_pct.toFixed(1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  )
}

function NgDashboardHistory({ contract }: { contract: McxContract }) {
  const [snapshots, setSnapshots] = useState<NgDashboardSnapshot[]>([])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    getNgDashboardHistory(t, contract, 90).then(setSnapshots).catch(() => {})
  }, [contract])

  const dayRows: HistoryRow[] = snapshots.map(s => ({
    key: s.date, last_price: s.last_price, open: s.open, high: s.high, low: s.low,
    volume: s.volume, oi: s.oi, buy_score_pct: s.buy_score_pct, sell_score_pct: s.sell_score_pct,
  }))
  const weekRows = aggregateSnapshots(snapshots, istWeekKey)
  const monthRows = aggregateSnapshots(snapshots, s => s.slice(0, 7))

  return (
    <div className="space-y-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">NG Dashboard History</p>
      <NgDashboardHistoryTable title="Daily" rows={dayRows} keyLabel="Date" defaultOpen={false} />
      <NgDashboardHistoryTable title="Weekly (Monday start)" rows={weekRows} keyLabel="Week Of" defaultOpen={false} />
      <NgDashboardHistoryTable title="Monthly" rows={monthRows} keyLabel="Month" defaultOpen={false} />
    </div>
  )
}

function trendBadgeStyle(trend: string): string {
  return DIRECTION_STYLE[trend] ?? DIRECTION_STYLE.UNKNOWN
}

function fmtNextEvent(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const opts: Intl.DateTimeFormatOptions = iso.includes('T')
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }
    : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }
  return d.toLocaleString('en-IN', opts)
}

function GlobalGasSymbolsTable() {
  const [rows, setRows] = useState<NgGlobalSymbolRow[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgGlobalSymbols(t).then(r => { setRows(r); setLastUpdated(new Date()) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Global Natural Gas Symbols</p>
        <LiveDot label={lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Loading…'} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {['Symbol', 'Exchange', 'LTP', 'Change', '% Change', 'Open', 'High', 'Low', 'Prev Close', 'Trend', 'AI Strength', 'Next Event', 'Market'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-zinc-400">Loading global Natural Gas symbols…</td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{r.display_symbol}</td>
                  <td className="px-3 py-2.5 text-zinc-500">{r.exchange}</td>
                  {r.ltp == null ? (
                    <td colSpan={10} className="px-3 py-2.5 text-amber-600 dark:text-amber-400">{r.note ?? 'No data available'}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 font-mono">₹{r.ltp.toFixed(2)}</td>
                      <td className={cls('px-3 py-2.5 font-mono', pnlColor(r.change ?? 0))}>{r.change! >= 0 ? '+' : ''}{r.change!.toFixed(2)}</td>
                      <td className={cls('px-3 py-2.5 font-mono', pnlColor(r.change_pct ?? 0))}>{r.change_pct! >= 0 ? '+' : ''}{r.change_pct!.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 font-mono">₹{r.open!.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-emerald-600 dark:text-emerald-400">₹{r.high!.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-red-500 dark:text-red-400">₹{r.low!.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono">₹{r.prev_close!.toFixed(2)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', trendBadgeStyle(r.trend))}>{r.trend}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold">
                        {r.ai_strength != null ? r.ai_strength.toFixed(1) : '—'}
                        {r.ai_strength_source === 'trend-strength' && <span className="ml-1 text-[10px] font-normal text-zinc-400">(trend)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-500">
                        {r.next_event ? (
                          <>
                            <span className="block">{fmtNextEvent(r.next_event)}</span>
                            <span className="text-[10px] text-zinc-400">{r.next_event_label}</span>
                          </>
                        ) : '—'}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2.5 text-zinc-500">{r.market}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        MCX rows use your connected Zerodha account's real quote and the actual NG-AI Pro score. Henry Hub (NYMEX)
        and Dutch TTF (ICE) come from Yahoo Finance daily data; their "AI Strength" is trend strength (EMA/ADX/MACD),
        not the full MCX score, since Kite-level order-flow data isn't available for foreign exchanges. UK NBP and
        JKM LNG are left out — Yahoo Finance has no usable data for either right now.
      </p>
    </div>
  )
}

type GlobalHistoryRow = {
  bucketKey: string
  symbolKey: string
  display_symbol: string
  ltp: number | null
  change_pct: number | null
  high: number | null
  low: number | null
  trend: string
  ai_strength: number | null
}

function aggregateGlobalSnapshots(
  snapshots: NgGlobalSymbolSnapshot[],
  keyFn: (date: string) => string,
): GlobalHistoryRow[] {
  const groups = new Map<string, NgGlobalSymbolSnapshot[]>()
  for (const s of snapshots) {
    const k = `${keyFn(s.date)}__${s.key}`
    const arr = groups.get(k) ?? []
    arr.push(s)
    groups.set(k, arr)
  }
  const rows = Array.from(groups.values()).map((items): GlobalHistoryRow => {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
    const last = sorted[sorted.length - 1]
    const highs = sorted.map(s => s.high).filter((h): h is number => h != null)
    const lows = sorted.map(s => s.low).filter((l): l is number => l != null)
    return {
      bucketKey: keyFn(last.date),
      symbolKey: last.key,
      display_symbol: last.display_symbol,
      ltp: last.ltp,
      change_pct: last.change_pct,
      high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null,
      trend: last.trend,
      ai_strength: last.ai_strength,
    }
  })
  return rows.sort((a, b) => b.bucketKey.localeCompare(a.bucketKey) || a.display_symbol.localeCompare(b.display_symbol))
}

function GlobalSymbolsHistoryTable({ title, rows, keyLabel, defaultOpen }: {
  title: string
  rows: GlobalHistoryRow[]
  keyLabel: string
  defaultOpen: boolean
}) {
  return (
    <CollapsibleCard title={title} defaultOpen={defaultOpen}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {[keyLabel, 'Symbol', 'LTP', '% Change', 'High', 'Low', 'Trend', 'AI Strength'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-400">
                  No snapshots yet — builds up once the daily snapshot job runs (near MCX close each trading day).
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={`${r.bucketKey}-${r.symbolKey}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 font-mono text-zinc-500">{r.bucketKey}</td>
                  <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{r.display_symbol}</td>
                  <td className="px-3 py-2.5 font-mono">{r.ltp != null ? `₹${r.ltp.toFixed(2)}` : '—'}</td>
                  <td className={cls('px-3 py-2.5 font-mono', r.change_pct != null ? pnlColor(r.change_pct) : '')}>
                    {r.change_pct != null ? `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-emerald-600 dark:text-emerald-400">{r.high != null ? `₹${r.high.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-red-500 dark:text-red-400">{r.low != null ? `₹${r.low.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', trendBadgeStyle(r.trend))}>{r.trend}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold">{r.ai_strength != null ? r.ai_strength.toFixed(1) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  )
}

function GlobalSymbolsHistory() {
  const [snapshots, setSnapshots] = useState<NgGlobalSymbolSnapshot[]>([])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    getNgGlobalSymbolsHistory(t, 90).then(setSnapshots).catch(() => {})
  }, [])

  const dayRows: GlobalHistoryRow[] = snapshots.map(s => ({
    bucketKey: s.date, symbolKey: s.key, display_symbol: s.display_symbol, ltp: s.ltp,
    change_pct: s.change_pct, high: s.high, low: s.low, trend: s.trend, ai_strength: s.ai_strength,
  })).sort((a, b) => b.bucketKey.localeCompare(a.bucketKey) || a.display_symbol.localeCompare(b.display_symbol))
  const weekRows = aggregateGlobalSnapshots(snapshots, istWeekKey)
  const monthRows = aggregateGlobalSnapshots(snapshots, s => s.slice(0, 7))

  return (
    <div className="space-y-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Global Natural Gas Symbols History</p>
      <GlobalSymbolsHistoryTable title="Daily" rows={dayRows} keyLabel="Date" defaultOpen={false} />
      <GlobalSymbolsHistoryTable title="Weekly (Monday start)" rows={weekRows} keyLabel="Week Of" defaultOpen={false} />
      <GlobalSymbolsHistoryTable title="Monthly" rows={monthRows} keyLabel="Month" defaultOpen={false} />
    </div>
  )
}

function NgDashboard({ quote, score, buyScore, sellScore, contract, loading, error }: {
  quote: NgQuote | null
  score: NgAiScore | null
  buyScore: NgAiScore | null
  sellScore: NgAiScore | null
  contract: McxContract
  loading: boolean
  error: string | null
}) {
  if (loading && !quote) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    )
  }
  if (error || !quote) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center dark:border-amber-900 dark:bg-amber-950/30">
        <p className="text-sm text-amber-800 dark:text-amber-300">{error ?? 'No MCX quote available.'}</p>
      </div>
    )
  }

  const stat = (label: string, value: string, accent = '') => (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={cls('mt-1 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-50', accent)}>{value}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-cyan-50 to-white p-6 dark:border-zinc-800 dark:from-cyan-950/20 dark:to-zinc-900">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
              MCX Natural Gas &middot; {quote.tradingsymbol}
            </p>
            <p className="mt-1 flex items-center gap-2 text-4xl font-bold font-mono text-zinc-900 dark:text-zinc-50">
              ₹{quote.last_price.toFixed(2)}
              {quote.stale && (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  title={quote.as_of ? `Zerodha unreachable — showing last known price from ${new Date(quote.as_of).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Zerodha unreachable — showing last known price'}
                >
                  Stale
                </span>
              )}
            </p>
            <p className={cls('mt-1 text-sm font-mono font-semibold', pnlColor(quote.change))}>
              {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.change >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
            </p>
            {score && (
              <span className={cls('mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold', VERDICT_STYLE[score.verdict])}>
                AI SIGNAL: {score.verdict === 'NO_TRADE' ? 'HOLD' : score.direction} &middot; {score.score_pct.toFixed(1)}
              </span>
            )}
          </div>
          <div className="text-right text-xs text-zinc-400">
            <p>Expiry {quote.expiry}</p>
            <p>Lot size {quote.lot_size} mmBtu</p>
            <p>Tick {quote.tick_size}</p>
          </div>
        </div>
      </div>

      <GlobalGasSymbolsTable />
      <GlobalSymbolsHistory />

      <div className="grid gap-4 lg:grid-cols-2">
        <BuySellScale buy={buyScore} sell={sellScore} />
        <NgWatchlist contract={contract} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Open', `₹${quote.open.toFixed(2)}`)}
        {stat('High', `₹${quote.high.toFixed(2)}`, 'text-emerald-600 dark:text-emerald-400')}
        {stat('Low', `₹${quote.low.toFixed(2)}`, 'text-red-500 dark:text-red-400')}
        {stat('Prev Close', `₹${quote.prev_close.toFixed(2)}`)}
        {stat('Volume', quote.volume.toLocaleString('en-IN'))}
        {stat('Open Interest', quote.oi.toLocaleString('en-IN'))}
        {stat('OI Day High', quote.oi_day_high.toLocaleString('en-IN'))}
        {stat('OI Day Low', quote.oi_day_low.toLocaleString('en-IN'))}
      </div>

      <NgDashboardHistory contract={contract} />
    </div>
  )
}

function NgChartTab({ quote, score, contract }: { quote: NgQuote | null; score: NgAiScore | null; contract: McxContract }) {
  const [period, setPeriod] = useState<ChartPeriod>('15m')

  return (
    <div className="space-y-4">
      <NgChart quote={quote} score={score} contract={contract} period={period} onPeriodChange={setPeriod} />
      {score && (
        <p className="text-[11px] text-zinc-400">
          Chart overlay is from the auto-computed AI Signal ({score.direction}, {score.score_pct.toFixed(1)}
          score) — refreshes automatically every 3 min, or visit the AI Signal tab to pick a direction/capital.
        </p>
      )}

      <PredictionAccuracyTable contract={contract} />

      <p className="text-xs text-zinc-400">
        Live price via your connected Zerodha Kite account for the current front-month MCX Natural Gas futures
        contract. Refreshes every 5s; the chart's last candle updates in real time between fetches. Dotted lines
        mark DH1/DL1 (day), DH2/DL2 (week), and DH3/DL3 (month) high-low.
      </p>
    </div>
  )
}

// ── AI Signal (NG-AI Pro v1) ──────────────────────────────────────────────────

const VERDICT_STYLE: Record<NgAiScore['verdict'], string> = {
  TRADE: 'bg-emerald-600 text-white',
  WATCHLIST: 'bg-amber-500 text-white',
  NO_TRADE: 'bg-zinc-400 text-white',
}

// Prominent summary shown at the top of the page, above the tab bar, so
// LTP + AI strength/confidence are visible on every tab (Dashboard, Chart,
// Trend, AI Signal, Trade, Portfolio) instead of only the Dashboard --
// condenses the quote header + the score already driving the AI Signal tab
// / Buy-Sell Scale into one always-visible banner.
function LtpStrengthBanner({ quote, score, buyScore, sellScore }: {
  quote: NgQuote | null
  score: NgAiScore | null
  buyScore: NgAiScore | null
  sellScore: NgAiScore | null
}) {
  if (!quote || !score) {
    return <div className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
  }
  const buyPct = buyScore?.score_pct ?? 0
  const sellPct = sellScore?.score_pct ?? 0
  const diff = buyPct - sellPct
  const lean = diff > 8 ? 'BUY' : diff < -8 ? 'SELL' : 'BALANCED'
  const leanStyle = lean === 'BUY' ? 'bg-emerald-600 text-white' : lean === 'SELL' ? 'bg-red-500 text-white' : 'bg-zinc-400 text-white'

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-5 py-3.5 dark:border-indigo-900 dark:from-indigo-950/30 dark:to-zinc-900">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">LTP</span>
        <span className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-50">₹{quote.last_price.toFixed(2)}</span>
        <span className={cls('text-xs font-mono font-semibold', pnlColor(quote.change))}>
          {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.change >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
        </span>
        {quote.stale && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
            title={quote.as_of ? `Zerodha unreachable — showing last known price from ${new Date(quote.as_of).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Zerodha unreachable — showing last known price'}
          >
            Stale
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">AI Strength</span>
        <span className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-50">{score.score_pct.toFixed(1)}</span>
        <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', VERDICT_STYLE[score.verdict])}>{score.verdict}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-zinc-400">Confidence</span>
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">BUY {buyPct.toFixed(1)}</span>
        <span className="text-zinc-300 dark:text-zinc-600">/</span>
        <span className="font-mono font-bold text-red-500 dark:text-red-400">SELL {sellPct.toFixed(1)}</span>
        <span className={cls('ml-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold', leanStyle)}>
          {lean === 'BALANCED' ? 'BALANCED' : `LEANING ${lean}`}
        </span>
      </div>
    </div>
  )
}

function ScoreGauge({ score, verdict }: { score: number; verdict: NgAiScore['verdict'] }) {
  return (
    <div className="flex items-center gap-4">
      <div className="text-5xl font-bold font-mono text-zinc-900 dark:text-zinc-50">{score.toFixed(1)}</div>
      <div>
        <span className={cls('rounded-full px-3 py-1 text-xs font-bold', VERDICT_STYLE[verdict])}>
          {verdict === 'TRADE' ? 'TAKE TRADE (≥85)' : verdict === 'WATCHLIST' ? 'WATCHLIST (70-84)' : 'NO TRADE (<70)'}
        </span>
        <p className="mt-1 text-[11px] text-zinc-400">Normalized to what's actually measurable (see below)</p>
      </div>
    </div>
  )
}

function CategoryRow({ cat }: { cat: NgAiScore['categories'][number] }) {
  const [open, setOpen] = useState(false)
  const pct = cat.available > 0 ? (cat.earned / cat.available) * 100 : 0
  return (
    <div className="border-b border-zinc-100 py-2.5 dark:border-zinc-800 last:border-0">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{cat.name}</span>
          <span className="text-[10px] text-zinc-400">(weight {cat.weight})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className={cls('h-full', pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400')} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="w-16 text-right font-mono text-xs text-zinc-500">{cat.earned}/{cat.available}</span>
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-1 pl-1">
          {cat.checks.map(chk => (
            <div key={chk.label} className="flex items-center justify-between text-xs">
              <span className={chk.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}>
                {chk.passed ? '✓' : '✗'} {chk.label} {chk.note && <span className="text-zinc-400">({chk.note})</span>}
              </span>
              <span className="font-mono text-zinc-400">{chk.points}/{chk.max}</span>
            </div>
          ))}
          {cat.excluded.map(ex => (
            <div key={ex} className="text-xs text-zinc-400">— {ex} <span className="italic">(not available)</span></div>
          ))}
        </div>
      )}
    </div>
  )
}

function AiSignalPanel({ onUseTrade, score, onScoreChange, contract }: {
  onUseTrade: (p: TradePrefill) => void
  score: NgAiScore | null
  onScoreChange: (s: NgAiScore | null) => void
  contract: McxContract
}) {
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY')
  const [capital, setCapital] = useState('100000')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const run = useCallback(async () => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    try {
      const s = await getNgAiScore(t, direction, parseFloat(capital) || 100000, contract)
      onScoreChange(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute AI score')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, contract])

  // Auto-compute whenever direction/contract changes, and again every 3 min
  // (the score is built from 15m candles, so refreshing much faster than
  // that adds load without adding signal) — no manual click needed anymore.
  useEffect(() => {
    run()
    if (!autoRefresh) return
    const id = setInterval(run, 180_000)
    return () => clearInterval(id)
  }, [run, autoRefresh])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/10 dark:text-indigo-300">
        NG-AI Pro v1 — rule-based score across Trend/Momentum/Volume/Price Action/Order Flow/Volatility/Correlation.
        Volume Profile, Cumulative Delta, bid/ask imbalance, and the EIA/OPEC/FOMC/RBI news filter aren&apos;t available
        yet (no tick data, L2 depth, or news source) — excluded from scoring, not silently failed. No ML: this is
        rule-based only, per the strategy&apos;s own note that ML needs more historical data first.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          {(['BUY', 'SELL'] as const).map(d => (
            <button key={d} onClick={() => setDirection(d)}
              className={cls(
                'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                direction === d
                  ? (d === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white')
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Capital (₹)</label>
          <input type="number" value={capital} onChange={e => setCapital(e.target.value)} onBlur={run}
            className="w-36 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
        </div>
        <button onClick={run} disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {loading ? 'Computing…' : 'Refresh Now'}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh every 3 min
        </label>
      </div>

      <p className="text-[11px] text-zinc-400">
        Computed automatically — recalculates whenever you switch BUY/SELL or the contract, and every 3 minutes
        while this tab is open.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

      {score && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <ScoreGauge score={score.score_pct} verdict={score.verdict} />
            <p className="mt-2 text-xs text-zinc-400">
              {score.tradingsymbol} · {direction} · price ₹{score.price.toFixed(2)} · {score.points_earned}/{score.points_available} pts measurable
              (of {score.points_nominal_total} nominal) · {score.candles_used} 15m candles used
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Category Breakdown</p>
            {score.categories.map(cat => <CategoryRow key={cat.name} cat={cat} />)}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Entry / Exit (1.5×ATR)</p>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">Entry</dt><dd className="font-mono font-semibold">₹{score.entry.entry_price.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Stop Loss</dt><dd className="font-mono font-semibold text-red-500">₹{score.entry.stop_loss.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Target 1 (30%)</dt><dd className="font-mono font-semibold text-emerald-600">₹{score.entry.target_1.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Target 2 (40%)</dt><dd className="font-mono font-semibold text-emerald-600">₹{score.entry.target_2.toFixed(2)}</dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-zinc-400">{score.entry.trail_remainder_note}</p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Position Sizing (1% risk)</p>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">Risk Amount</dt><dd className="font-mono font-semibold">₹{score.position_sizing.risk_amount.toLocaleString('en-IN')}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Lot Size</dt><dd className="font-mono">{score.position_sizing.lot_size} mmBtu</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">1-Lot Risk</dt><dd className="font-mono">{score.position_sizing.one_lot_risk != null ? `₹${score.position_sizing.one_lot_risk.toLocaleString('en-IN')}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Suggested Lots</dt><dd className="font-mono font-bold">{score.position_sizing.suggested_lots}</dd></div>
              </dl>
              {score.position_sizing.note && (
                <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  {score.position_sizing.note}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Risk Rules</p>
            <p className="text-xs text-zinc-500">
              Max {score.risk_rules.max_trades_per_day} trades/day · stop after {score.risk_rules.stop_after_consecutive_losses} consecutive losses ·
              daily loss limit {score.risk_rules.daily_loss_limit_pct}% · daily profit target {score.risk_rules.daily_profit_target_pct}% ·
              never average down. Enforced by discipline, not auto-blocked yet.
            </p>
          </div>

          <button
            onClick={() => onUseTrade({
              signal: score.direction,
              lots: score.position_sizing.suggested_lots || 1,
              stopLoss: score.entry.stop_loss,
              target: score.entry.target_1,
            })}
            disabled={score.position_sizing.suggested_lots < 1}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Use This Signal → Go to Trade Tab
          </button>
        </div>
      )}
    </div>
  )
}

// ── Trade Signals ────────────────────────────────────────────────────────────

const SIGNAL_RESULT_STYLE: Record<string, string> = {
  WIN: 'bg-emerald-600 text-white',
  LOSS: 'bg-red-500 text-white',
  EXPIRED: 'bg-zinc-400 text-white',
}

function fmtSignalDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}

function TradeSignalsTable({ contract }: { contract: McxContract }) {
  const [data, setData] = useState<NgSignalsResponse | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgSignals(t, contract, 50).then(setData).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [contract])

  const acc = data?.accuracy

  return (
    <CollapsibleCard
      title="Trade Signals"
      defaultOpen
      subtitle={
        acc && acc.resolved > 0 ? (
          <span className="text-[11px] text-zinc-400">
            Accuracy <span className="font-semibold text-zinc-600 dark:text-zinc-300">{acc.accuracy_pct?.toFixed(1)}%</span> ({acc.wins}/{acc.resolved} resolved)
          </span>
        ) : (
          <span className="text-[11px] text-zinc-400">No resolved signals yet</span>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {['Generated', 'Direction', 'Entry', 'SL', 'Target', 'Result', 'P&L / SL Hit', 'Days to Close'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {!data || data.signals.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-400">
                  No trade signals yet — a new row is logged automatically whenever the AI score hits TRADE (≥85)
                  for BUY or SELL, one open signal per direction at a time.
                </td>
              </tr>
            ) : (
              data.signals.map((s, i) => (
                <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 font-mono text-zinc-500">{fmtSignalDateTime(s.generated_at)}</td>
                  <td className="px-3 py-2.5">
                    <span className={cls('rounded px-2 py-0.5 text-[10px] font-bold text-white', s.direction === 'BUY' ? 'bg-emerald-600' : 'bg-red-500')}>
                      {s.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono">₹{s.entry_price.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-red-500">₹{s.stop_loss.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-emerald-600">₹{s.target_1.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    {s.result ? (
                      <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', SIGNAL_RESULT_STYLE[s.result])}>{s.result}</span>
                    ) : (
                      <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">OPEN</span>
                    )}
                  </td>
                  <td className={cls('px-3 py-2.5 font-mono font-semibold', s.pnl == null ? 'text-zinc-400' : pnlColor(s.pnl))}>
                    {s.result === 'LOSS' ? `SL Hit ₹${s.exit_price?.toFixed(2)}` : s.pnl != null ? `₹${s.pnl.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-zinc-500">{s.days_to_close != null ? s.days_to_close.toFixed(2) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        Logged automatically (not tied to whether you actually placed a trade) whenever the AI score hits verdict
        TRADE, one open signal per direction at a time. Closes WIN (target hit), LOSS (stop-loss hit), or EXPIRED
        after 5 trading days with neither. Accuracy = wins ÷ (wins + losses), excluding expired.
      </p>
    </CollapsibleCard>
  )
}

function newsSentimentLabel(score: number): { label: string; cls: string } {
  if (score > 0.1) return { label: 'Bullish', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' }
  if (score < -0.1) return { label: 'Bearish', cls: 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400' }
  return { label: 'Neutral', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' }
}

// International NG/energy news feeding the AI score's News Filter category
// (see mcx_ai_score_service.py's _score_news) -- shown here so a directional
// nudge from news sentiment isn't an invisible black box; every headline
// that contributed to the aggregate is visible with its own sentiment read.
function NgNewsPanel() {
  const [data, setData] = useState<NgNewsResponse | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgNews(t, 20).then(setData).catch(() => {})
    }
    load()
    const id = setInterval(load, 300_000)
    return () => clearInterval(id)
  }, [])

  const overall = data?.avg_sentiment != null ? newsSentimentLabel(data.avg_sentiment) : null

  return (
    <CollapsibleCard
      title="Recent NG News"
      defaultOpen={false}
      subtitle={
        overall ? (
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            Overall
            <span className={cls('rounded-full px-2 py-0.5 text-[10px] font-bold', overall.cls)}>{overall.label}</span>
            ({data?.avg_sentiment?.toFixed(2)})
          </span>
        ) : (
          <span className="text-[11px] text-zinc-400">No recent articles</span>
        )
      }
    >
      {!data || data.articles.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-zinc-400">
          No NG-relevant articles fetched yet — the news feed job runs every 30 minutes.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-50 dark:divide-zinc-800">
          {data.articles.map((a, i) => {
            const s = newsSentimentLabel(a.sentiment_score)
            return (
              <li key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-zinc-800 hover:underline dark:text-zinc-200">
                    {a.title}
                  </a>
                  <span className={cls('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', s.cls)}>{s.label}</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {a.source} &middot; {new Date(a.published_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        OilPrice.com, Investing.com Commodities, and Natural Gas Intel, filtered to NG-relevant articles and
        keyword-scored for sentiment (not an LLM read of the article) — the same feed behind the AI score's News
        Filter category. A coarse signal, not analysis; verify anything that looks market-moving before trading on it.
      </p>
    </CollapsibleCard>
  )
}

// ── Trend Ladder ──────────────────────────────────────────────────────────────

const TIMEFRAME_LABELS: Record<string, string> = {
  '1m': '1 min', '5m': '5 min', '15m': '15 min', '1h': '1 hour', '1D': '1 day', '1W': '1 week',
}
const TIMEFRAME_ORDER = ['1m', '5m', '15m', '1h', '1D', '1W']

const DIRECTION_STYLE: Record<string, string> = {
  BULLISH: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
  BEARISH: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400',
  NEUTRAL: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  UNKNOWN: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500',
}

const CHANGE_STATE_STYLE: Record<string, string> = {
  JUST_CHANGED: 'bg-red-600 text-white',
  WEAKENING: 'bg-amber-500 text-white',
  STABLE: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
}

function TrendRow({ timeframe, data }: { timeframe: string; data: TrendTimeframe }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 py-3 dark:border-zinc-800 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-16 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{TIMEFRAME_LABELS[timeframe] ?? timeframe}</span>
        <span className={cls('rounded-full px-2.5 py-0.5 text-xs font-bold', DIRECTION_STYLE[data.direction])}>
          {data.direction}
        </span>
        {data.change_state && data.change_state !== 'STABLE' && (
          <span className={cls('rounded-full px-2 py-0.5 text-[10px] font-bold', CHANGE_STATE_STYLE[data.change_state])}>
            {data.change_state.replace('_', ' ')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {data.direction === 'UNKNOWN' ? (
          <span className="text-xs text-zinc-400">{data.reason ?? 'insufficient history'}</span>
        ) : (
          <>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={cls('h-full', data.direction === 'BULLISH' ? 'bg-emerald-500' : data.direction === 'BEARISH' ? 'bg-red-500' : 'bg-zinc-400')}
                style={{ width: `${Math.min(100, data.strength)}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-xs text-zinc-500">{data.strength.toFixed(0)}</span>
          </>
        )}
      </div>
    </div>
  )
}

function TrendPanel({ contract }: { contract: McxContract }) {
  const [ladder, setLadder] = useState<NgTrendLadder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    getNgTrend(t, contract)
      .then(setLadder)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load trend ladder'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/10 dark:text-indigo-300">
        Rule-based trend classification (EMA20/50 alignment + ADX + MACD histogram) across every timeframe.
        A background job also checks this every 15 minutes during market hours and emails + notifies you when
        a trend just flipped or is weakening — no need to keep this tab open.
      </div>

      {loading && !ladder ? (
        <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      ) : error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-800 dark:text-amber-300">{error}</p>
        </div>
      ) : ladder ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{ladder.tradingsymbol}</p>
            <button onClick={load} className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">Refresh</button>
          </div>
          {TIMEFRAME_ORDER.map(tf => (
            <TrendRow key={tf} timeframe={tf} data={ladder.ladder[tf] ?? { direction: 'UNKNOWN', strength: 0 }} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Trade ─────────────────────────────────────────────────────────────────────

function NgTradeForm({ quote, onPlaced, prefill, contract }: { quote: NgQuote | null; onPlaced: () => void; prefill?: TradePrefill | null; contract: McxContract }) {
  const [signal, setSignal] = useState<'BUY' | 'SELL'>('BUY')
  const [lots, setLots] = useState('1')
  const [stopLoss, setStopLoss] = useState('')
  const [target, setTarget] = useState('')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!prefill) return
    setSignal(prefill.signal)
    setLots(String(prefill.lots))
    setStopLoss(String(prefill.stopLoss))
    setTarget(String(prefill.target))
  }, [prefill])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(null)
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setSubmitting(true)
    try {
      const trade = await placeNgTrade(t, {
        signal,
        lots: parseInt(lots, 10),
        stop_loss: parseFloat(stopLoss),
        target: parseFloat(target),
        limit_price: orderType === 'LIMIT' ? parseFloat(limitPrice) : undefined,
        contract,
      })
      setSuccess(`${signal} ${lots} lot(s) placed at ₹${trade.entry_price.toFixed(2)}`)
      setStopLoss(''); setTarget(''); setLimitPrice('')
      onPlaced()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place trade')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

  return (
    <div className="max-w-xl">
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {quote && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {quote.tradingsymbol} &middot; LTP ₹{quote.last_price.toFixed(2)} &middot; Lot size {quote.lot_size} mmBtu
          </div>
        )}

        <div className="flex gap-2">
          {(['BUY', 'SELL'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSignal(s)}
              className={cls(
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
                signal === s
                  ? (s === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white')
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Lots</label>
          <input type="number" min={1} value={lots} onChange={e => setLots(e.target.value)} className={inputCls} required />
        </div>

        <div className="flex gap-2">
          {(['MARKET', 'LIMIT'] as const).map(t => (
            <button key={t} type="button" onClick={() => setOrderType(t)}
              className={cls(
                'flex-1 rounded-lg py-1.5 text-xs font-semibold',
                orderType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {orderType === 'LIMIT' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Limit Price</label>
            <input type="number" step="0.1" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} className={inputCls} required />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Stop Loss</label>
            <input type="number" step="0.1" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Target</label>
            <input type="number" step="0.1" value={target} onChange={e => setTarget(e.target.value)} className={inputCls} required />
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">{success}</p>}

        <button type="submit" disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? 'Placing…' : `Place ${signal} Order (Paper)`}
        </button>
        <p className="text-center text-[11px] text-zinc-400">
          Paper trade only — simulated against the real live MCX price, no real order is sent.
        </p>
      </form>
    </div>
  )
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

function TradeRow({ t, showClose, onClose, closing }: {
  t: McxTrade; showClose: boolean; onClose?: (id: string) => void; closing?: boolean
}) {
  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{t.symbol}</td>
      <td className="px-3 py-2.5">
        <span className={cls('rounded px-2 py-0.5 text-[10px] font-bold text-white', t.signal === 'BUY' ? 'bg-emerald-600' : 'bg-red-500')}>
          {t.signal}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono">{t.lots}</td>
      <td className="px-3 py-2.5 font-mono">₹{t.entry_price.toFixed(2)}</td>
      {showClose ? (
        <>
          <td className="px-3 py-2.5 font-mono text-red-500">₹{t.stop_loss.toFixed(2)}</td>
          <td className="px-3 py-2.5 font-mono text-emerald-600">₹{t.target.toFixed(2)}</td>
          <td className="px-3 py-2.5 capitalize text-zinc-500">{t.status}</td>
          <td className="px-3 py-2.5">
            {t.status === 'open' && onClose && (
              <button onClick={() => onClose(t.id)} disabled={closing}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {closing ? 'Closing…' : 'Close'}
              </button>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-2.5 font-mono">{t.exit_price != null ? `₹${t.exit_price.toFixed(2)}` : '—'}</td>
          <td className={cls('px-3 py-2.5 font-mono font-semibold', pnlColor(t.pnl ?? 0))}>
            {t.pnl != null ? `₹${t.pnl.toFixed(2)}` : '—'}
          </td>
          <td className="px-3 py-2.5 capitalize text-zinc-500">{t.status}</td>
        </>
      )}
    </tr>
  )
}

function NgPortfolio({ trades, loading, onClose, closingId }: {
  trades: McxTrade[]; loading: boolean; onClose: (id: string) => void; closingId: string | null
}) {
  const open = trades.filter(t => t.status === 'open' || t.status === 'pending')
  const closed = trades.filter(t => t.status === 'closed' || t.status === 'cancelled')
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)

  if (loading) return <div className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No MCX Natural Gas trades yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Open Positions</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{open.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Closed Trades</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{closed.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Realized P&amp;L</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(totalPnl))}>₹{totalPnl.toFixed(2)}</p>
        </div>
      </div>

      {open.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Open</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Contract', 'Signal', 'Lots', 'Entry', 'SL', 'Target', 'Status', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {open.map(t => (
                  <TradeRow key={t.id} t={t} showClose onClose={onClose} closing={closingId === t.id} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Closed</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Contract', 'Signal', 'Lots', 'Entry', 'Exit', 'P&L', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {closed.map(t => <TradeRow key={t.id} t={t} showClose={false} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'NG Dashboard' },
  { id: 'chart', label: 'Chart' },
  { id: 'trend', label: 'Trend' },
  { id: 'ai', label: 'AI Signal' },
  { id: 'trade', label: 'Trade' },
  { id: 'portfolio', label: 'Portfolio' },
]

export default function McxView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [contract, setContract] = useState<McxContract>('NG')
  const [broker, setBroker] = useState<BrokerStatus | null>(null)
  const [quote, setQuote] = useState<NgQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [trades, setTrades] = useState<McxTrade[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [tradePrefill, setTradePrefill] = useState<TradePrefill | null>(null)
  const [score, setScore] = useState<NgAiScore | null>(null)
  const [buyScore, setBuyScore] = useState<NgAiScore | null>(null)
  const [sellScore, setSellScore] = useState<NgAiScore | null>(null)

  const loadQuote = useCallback(() => {
    const t = tokenRef.current
    if (!t) return
    getNgQuote(t, contract)
      .then(q => { setQuote(q); setQuoteError(null); setQuoteLoading(false) })
      .catch(err => { setQuoteError(err instanceof Error ? err.message : 'Failed to load MCX quote'); setQuoteLoading(false) })
  }, [contract])

  const loadTrades = useCallback(() => {
    const t = tokenRef.current
    if (!t) return
    setTradesLoading(true)
    listNgTrades(t).then(ts => { setTrades(ts); setTradesLoading(false) }).catch(() => setTradesLoading(false))
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getBrokerStatus(t).then(setBroker).catch(() => null)
    loadQuote()
    loadTrades()
    const id = setInterval(loadQuote, 5_000)
    return () => clearInterval(id)
  }, [router, loadQuote, loadTrades])

  // Session-expiry check: a token that exists in localStorage but is no
  // longer valid (past ACCESS_TOKEN_EXPIRE_MINUTES, no refresh endpoint
  // exists yet) otherwise leaves every widget on this page silently 401ing
  // forever with no indication to the user that re-login would fix it --
  // same failure mode already fixed on the main Dashboard tab. getMe() is
  // the cheapest authenticated call, and only a genuine 401 (not a network
  // blip or a slow backend) sends the user back to /login.
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

  // Auto-compute BUY + SELL AI scores as soon as the page loads, so the
  // Dashboard chart's signal overlay and the buy/sell weight scale are
  // populated without ever needing to visit the AI Signal tab. Visiting that
  // tab takes over `score` with whatever direction/capital is selected there.
  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) return
    function load() {
      getNgAiScore(t as string, 'BUY', 100000, contract).then(s => { setScore(s); setBuyScore(s) }).catch(() => {})
      getNgAiScore(t as string, 'SELL', 100000, contract).then(setSellScore).catch(() => {})
    }
    load()
    const id = setInterval(load, 180_000)
    return () => clearInterval(id)
  }, [contract])

  async function handleClose(id: string) {
    setClosingId(id)
    try {
      await closeNgTrade(tokenRef.current, id)
      loadTrades()
    } catch {
      // surfaced via trade list staying unchanged; keep it simple
    } finally {
      setClosingId(null)
    }
  }

  const zerodhaConnected = broker?.broker === 'zerodha' && broker.connected

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Natural Gas" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">MCX Natural Gas</h1>
            <p className="text-xs text-zinc-400">
              Live front-month MCX futures dashboard, multi-timeframe trend alerts, and paper trading against the real price.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {CONTRACTS.map(c => (
              <button key={c.id} onClick={() => { setContract(c.id); setScore(null); setBuyScore(null); setSellScore(null) }}
                className={cls(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  contract === c.id ? 'bg-white text-zinc-900 shadow dark:bg-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {!zerodhaConnected && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            MCX has no free public data feed — connect your Zerodha account to see live prices and trade.{' '}
            <a href="/broker" className="font-semibold underline">Go to Broker settings →</a>
          </div>
        )}

        {zerodhaConnected && (
          <div className="mb-6">
            <LtpStrengthBanner quote={quote} score={score} buyScore={buyScore} sellScore={sellScore} />
          </div>
        )}

        <div className="mb-6 flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cls(
                'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && (
          <NgDashboard quote={quote} score={score} buyScore={buyScore} sellScore={sellScore} contract={contract} loading={quoteLoading} error={quoteError} />
        )}
        {tab === 'chart' && <NgChartTab quote={quote} score={score} contract={contract} />}
        {tab === 'trend' && <TrendPanel contract={contract} />}
        {tab === 'ai' && (
          <div className="space-y-6">
            <AiSignalPanel
              score={score}
              onScoreChange={setScore}
              onUseTrade={p => { setTradePrefill(p); setTab('trade') }}
              contract={contract}
            />
            <TradeSignalsTable contract={contract} />
            <NgNewsPanel />
          </div>
        )}
        {tab === 'trade' && <NgTradeForm quote={quote} onPlaced={loadTrades} prefill={tradePrefill} contract={contract} />}
        {tab === 'portfolio' && (
          <NgPortfolio trades={trades} loading={tradesLoading} onClose={handleClose} closingId={closingId} />
        )}
      </main>
    </div>
  )
}

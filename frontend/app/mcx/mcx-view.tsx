'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import type { AILevels, RefLine, PredictionPoint } from '@/components/price-chart'
import {
  getNgQuote, listNgTrades, placeNgTrade, closeNgTrade, getBrokerStatus, getNgAiScore, getNgHistory, getNgTrend, getNgRangeStats, getNgPrediction,
} from '@/lib/api'
import type {
  NgQuote, McxTrade, BrokerStatus, NgAiScore, HistoryBar, ChartPeriod, McxContract, NgTrendLadder, TrendTimeframe, NgRangeStats, NgPrediction,
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

const ACCURACY_ROWS: { label: string; period: ChartPeriod }[] = [
  { label: 'Minutes', period: '15m' },
  { label: 'Hours', period: '1h' },
  { label: 'Days', period: '1D' },
  { label: 'Weeks', period: '1W' },
]

function fmtPredictionTime(t: number): string {
  return new Date(t * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function PredictionAccuracyTable({ contract }: { contract: McxContract }) {
  const [byPeriod, setByPeriod] = useState<Partial<Record<ChartPeriod, NgPrediction>>>({})

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      for (const row of ACCURACY_ROWS) {
        getNgPrediction(t, contract, row.period)
          .then(p => setByPeriod(prev => ({ ...prev, [row.period]: p })))
          .catch(() => {})
      }
    }
    load()
    const id = setInterval(load, 120_000)
    return () => clearInterval(id)
  }, [contract])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <p className="border-b border-zinc-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
        AI Prediction Accuracy &middot; Minutes / Hours / Days / Weeks
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {['Timeframe', 'Time', 'Actual Price', 'Predicted Price', 'Accuracy'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {ACCURACY_ROWS.map(row => {
              const p = byPeriod[row.period]
              const resolved = p?.history.filter(h => h.actual_close != null)
              const latest = resolved && resolved.length > 0 ? resolved[resolved.length - 1] : null
              return (
                <tr key={row.period} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 font-semibold text-zinc-900 dark:text-zinc-50">{row.label}</td>
                  <td className="px-3 py-2.5 font-mono text-zinc-500">{latest ? fmtPredictionTime(latest.time) : '—'}</td>
                  <td className="px-3 py-2.5 font-mono">{latest?.actual_close != null ? `₹${latest.actual_close.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 font-mono">{latest ? `₹${latest.predicted_close.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 font-mono font-semibold">
                    {p && p.accuracy.sample_size > 0 ? (
                      <span className={p.accuracy.hit_rate_pct != null && p.accuracy.hit_rate_pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                        {p.accuracy.hit_rate_pct?.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        One representative period per bucket (15m/1h/1D/1W). Accuracy is the rolling % of past predictions whose
        actual close landed inside the predicted band; builds up as time passes each predicted candle.
      </p>
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
            <p className="mt-1 text-4xl font-bold font-mono text-zinc-900 dark:text-zinc-50">₹{quote.last_price.toFixed(2)}</p>
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
      <NavBar active="MCX" />
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
          <AiSignalPanel
            score={score}
            onScoreChange={setScore}
            onUseTrade={p => { setTradePrefill(p); setTab('trade') }}
            contract={contract}
          />
        )}
        {tab === 'trade' && <NgTradeForm quote={quote} onPlaced={loadTrades} prefill={tradePrefill} contract={contract} />}
        {tab === 'portfolio' && (
          <NgPortfolio trades={trades} loading={tradesLoading} onClose={handleClose} closingId={closingId} />
        )}
      </main>
    </div>
  )
}

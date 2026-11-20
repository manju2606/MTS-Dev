'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  getLiquidityBacktest,
  getLiquidityMtf,
  getLiquidityOrderFlow,
  getLiquidityScan,
  type LiquidityBacktestResult,
  type LiquidityMtfResult,
  type LiquidityOrderFlowResult,
  type LiquidityScanResult,
} from '@/lib/api'

const SIGNAL_TEXT: Record<string, string> = {
  BUY: 'text-emerald-600 dark:text-emerald-400',
  SELL: 'text-red-600 dark:text-red-400',
  HOLD: 'text-zinc-500 dark:text-zinc-400',
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p className={`text-sm font-semibold ${tone ?? 'text-zinc-900 dark:text-zinc-100'}`}>{value}</p>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  )
}

function RunButton({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {loading ? 'Running…' : label}
    </button>
  )
}

// Hook: load on mount (deferred, like the rest of the codebase) and expose a manual reload.
function useLoader<T>(fetcher: (token: string) => Promise<T>, auto: boolean) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const token = localStorage.getItem('mts_token')
    if (!token) { setError('Please sign in again.'); return }
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher(token))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  useEffect(() => {
    if (!auto) return
    const id = setTimeout(() => { run() }, 0)
    return () => clearTimeout(id)
  }, [auto, run])

  return { data, loading, error, run }
}

// ── Multi-timeframe ──────────────────────────────────────────────────────────

export function MtfPanel({ symbol }: { symbol: string }) {
  const fetcher = useCallback((t: string) => getLiquidityMtf(t, symbol), [symbol])
  const { data, loading, error, run } = useLoader<LiquidityMtfResult>(fetcher, true)

  const verdictTone = data?.confirmation.verdict.startsWith('CONFIRMED BUY')
    ? 'text-emerald-600 dark:text-emerald-400'
    : data?.confirmation.verdict.startsWith('CONFIRMED SELL')
      ? 'text-red-600 dark:text-red-400'
      : data?.confirmation.verdict === 'CONFLICT'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-zinc-700 dark:text-zinc-200'

  return (
    <Card title="Multi-timeframe confirmation" right={<RunButton onClick={run} loading={loading} label="Refresh" />}>
      <p className="mb-3 text-xs text-zinc-500">
        The daily timeframe sets the bias. The hourly timeframe must agree before a signal counts as confirmed.
      </p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <p className="text-xs text-zinc-400">Loading…</p>}
      {data && (
        <div className="space-y-4">
          <div>
            <p className={`text-base font-bold ${verdictTone}`}>{data.confirmation.verdict.replace(/_/g, ' ')}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{data.confirmation.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="text-[11px] text-zinc-400">Daily (bias)</p>
              <p className={`text-sm font-bold ${SIGNAL_TEXT[data.daily.signal]}`}>{data.daily.signal}</p>
              <p className="text-[11px] text-zinc-500">trend {data.daily.trend} · conf {Math.round(data.daily.confidence * 100)}%</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="text-[11px] text-zinc-400">Hourly (confirm)</p>
              <p className={`text-sm font-bold ${SIGNAL_TEXT[data.hourly.signal]}`}>{data.hourly.signal}</p>
              <p className="text-[11px] text-zinc-500">trend {data.hourly.trend} · conf {Math.round(data.hourly.confidence * 100)}%</p>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400">{data.disclaimer}</p>
        </div>
      )}
    </Card>
  )
}

// ── Backtest ─────────────────────────────────────────────────────────────────

export function BacktestPanel({ symbol, interval }: { symbol: string; interval: '1d' | '1h' }) {
  const fetcher = useCallback((t: string) => getLiquidityBacktest(t, symbol, interval), [symbol, interval])
  const { data, loading, error, run } = useLoader<LiquidityBacktestResult>(fetcher, false)
  const m = data?.metrics

  return (
    <Card
      title="Historical backtest"
      right={<RunButton onClick={run} loading={loading} label={data ? 'Re-run' : 'Run backtest'} />}
    >
      <p className="mb-3 text-xs text-zinc-500">
        Causal replay: each signal uses only past candles, enters at the next open, and includes slippage.
        If a bar hits both stop and target, the stop is assumed first. Results are a sample, not a promise.
      </p>
      {error && <ErrorBox message={error} />}
      {loading && <p className="text-xs text-zinc-400">Replaying history… this can take a few seconds.</p>}
      {data && m && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Trades" value={String(m.trades)} />
            <Stat label="Win rate" value={m.win_rate === null ? '—' : `${Math.round(m.win_rate * 100)}%`} />
            <Stat label="Expectancy (R)" value={fmt(m.expectancy_r, 2)}
              tone={(m.expectancy_r ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
            <Stat label="Profit factor" value={fmt(m.profit_factor, 2)} />
            <Stat label="Total R" value={fmt(m.total_r, 2)} />
            <Stat label="Max drawdown (R)" value={fmt(m.max_drawdown_r, 2)} />
            <Stat label="Avg bars held" value={fmt(m.avg_bars_held, 1)} />
            <Stat label="Long / short" value={`${m.long} / ${m.short}`} />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              Segmented out-of-sample check ({data.walk_forward.folds} consecutive segments)
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-zinc-400">
                <tr><th className="py-1">Segment</th><th>Period</th><th>Trades</th><th>Win rate</th><th>Expectancy (R)</th></tr>
              </thead>
              <tbody>
                {data.walk_forward.segments.map(s => (
                  <tr key={s.fold} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5">{s.fold}</td>
                    <td>{fmtDate(s.from)} – {fmtDate(s.to)}</td>
                    <td>{s.metrics.trades}</td>
                    <td>{s.metrics.win_rate === null ? '—' : `${Math.round(s.metrics.win_rate * 100)}%`}</td>
                    <td>{fmt(s.metrics.expectancy_r, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-zinc-500">
              Positive in {data.walk_forward.positive_expectancy_folds} of {data.walk_forward.folds} segments
              (stability {Math.round(data.walk_forward.stability * 100)}%). No parameters are fitted here.
            </p>
          </div>

          {data.monte_carlo.sims ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                Monte Carlo bootstrap ({data.monte_carlo.sims} simulations)
              </p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Final R, 5th pct" value={fmt(data.monte_carlo.final_r_p5, 2)} />
                <Stat label="Final R, median" value={fmt(data.monte_carlo.final_r_p50, 2)} />
                <Stat label="Final R, 95th pct" value={fmt(data.monte_carlo.final_r_p95, 2)} />
                <Stat label="Chance of profit" value={data.monte_carlo.prob_profit === undefined ? '—' : `${Math.round(data.monte_carlo.prob_profit * 100)}%`} />
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">Latest trades</p>
            {data.trades.length === 0 ? (
              <p className="text-xs text-zinc-400">No trades were taken in this history.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-zinc-400">
                    <tr><th className="py-1">Entry</th><th>Side</th><th>Entry ₹</th><th>Stop ₹</th><th>Target ₹</th><th>Exit</th><th>R</th></tr>
                  </thead>
                  <tbody>
                    {data.trades.slice(-15).reverse().map(t => (
                      <tr key={`${t.entry_time}-${t.side}`} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5">{fmtDate(t.entry_time)}</td>
                        <td className={SIGNAL_TEXT[t.side]}>{t.side}</td>
                        <td>{fmt(t.entry)}</td>
                        <td>{fmt(t.stop)}</td>
                        <td>{fmt(t.target)}</td>
                        <td>{t.reason} @ {fmt(t.exit_price)}</td>
                        <td className={t.r_multiple >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{fmt(t.r_multiple, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-[10px] text-zinc-400">{data.disclaimer}</p>
        </div>
      )}
    </Card>
  )
}

// ── Market scanner ───────────────────────────────────────────────────────────

export function ScannerPanel() {
  const [universe, setUniverse] = useState<'nifty50' | 'nifty100' | 'nifty200'>('nifty50')
  const [side, setSide] = useState<'bullish' | 'bearish' | 'all'>('all')
  const fetcher = useCallback((t: string) => getLiquidityScan(t, universe, side), [universe, side])
  const { data, loading, error, run } = useLoader<LiquidityScanResult>(fetcher, false)

  return (
    <Card
      title="Market scanner"
      right={
        <div className="flex items-center gap-2">
          <select value={universe} onChange={e => setUniverse(e.target.value as typeof universe)}
            aria-label="Universe" className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="nifty50">NIFTY 50</option>
            <option value="nifty100">NIFTY 100</option>
            <option value="nifty200">NIFTY 200</option>
          </select>
          <select value={side} onChange={e => setSide(e.target.value as typeof side)}
            aria-label="Side" className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="all">Bullish & bearish</option>
            <option value="bullish">Bullish only</option>
            <option value="bearish">Bearish only</option>
          </select>
          <RunButton onClick={run} loading={loading} label="Scan" />
        </div>
      }
    >
      <p className="mb-3 text-xs text-zinc-500">
        Ranks stocks by the engine&apos;s confidence score. Results are cached for 10 minutes. Scanning NIFTY 200 can take a while.
      </p>
      {error && <ErrorBox message={error} />}
      {loading && <p className="text-xs text-zinc-400">Scanning… fetching daily history for each stock.</p>}
      {data && (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-500">
            {data.matches} setups from {data.analysed} of {data.scanned} stocks ({data.failed_count} could not be loaded and were skipped).
          </p>
          {data.results.length === 0 ? (
            <p className="text-xs text-zinc-400">No setups met the threshold right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-zinc-400">
                  <tr><th className="py-1">Symbol</th><th>Signal</th><th>Conf</th><th>Entry ₹</th><th>Stop ₹</th><th>Target ₹</th><th>R:R</th><th>Trend</th></tr>
                </thead>
                <tbody>
                  {data.results.map(r => (
                    <tr key={r.symbol} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 font-semibold text-zinc-900 dark:text-zinc-100">{r.symbol.replace(/\.(NS|BO)$/, '')}</td>
                      <td className={`font-bold ${SIGNAL_TEXT[r.signal]}`}>{r.signal}</td>
                      <td>{Math.round(r.confidence * 100)}%</td>
                      <td>{fmt(r.entry_price)}</td>
                      <td>{fmt(r.stop_loss)}</td>
                      <td>{fmt(r.target)}</td>
                      <td>{fmt(r.risk_reward_ratio)}</td>
                      <td>{r.trend}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-zinc-400">{data.disclaimer}</p>
        </div>
      )}
    </Card>
  )
}

// ── Order flow ───────────────────────────────────────────────────────────────

export function OrderFlowPanel({ symbol, interval }: { symbol: string; interval: '1d' | '1h' }) {
  const fetcher = useCallback((t: string) => getLiquidityOrderFlow(t, symbol, interval), [symbol, interval])
  const { data, loading, error, run } = useLoader<LiquidityOrderFlowResult>(fetcher, true)

  const maxVol = data ? Math.max(1, ...data.volume_profile.buckets.map(b => b.volume)) : 1
  const lastCvd = data?.cvd.series.at(-1)
  const cvdTrend = data && data.cvd.series.length > 5
    ? (data.cvd.series.at(-1)!.cvd - data.cvd.series.at(-6)!.cvd)
    : 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Volume profile (estimate)" right={<RunButton onClick={run} loading={loading} label="Refresh" />}>
        {error && <ErrorBox message={error} />}
        {loading && !data && <p className="text-xs text-zinc-400">Loading…</p>}
        {data && (
          <div className="space-y-3">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">{data.volume_profile.note}</p>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="POC" value={fmt(data.volume_profile.poc)} />
              <Stat label="Value area high" value={fmt(data.volume_profile.value_area_high)} />
              <Stat label="Value area low" value={fmt(data.volume_profile.value_area_low)} />
            </div>
            <div className="flex max-h-72 flex-col-reverse gap-px overflow-y-auto">
              {data.volume_profile.buckets.map(b => {
                const inVA = data.volume_profile.value_area_low !== null && data.volume_profile.value_area_high !== null
                  && b.high >= data.volume_profile.value_area_low && b.low <= data.volume_profile.value_area_high
                const isPoc = data.volume_profile.poc !== null && b.low <= data.volume_profile.poc && b.high >= data.volume_profile.poc
                return (
                  <div key={`${b.low}-${b.high}`} className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 shrink-0 text-right text-zinc-400">{fmt(b.low, 1)}</span>
                    <div className="h-3 flex-1 rounded-sm bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-sm ${isPoc ? 'bg-amber-500' : inVA ? 'bg-indigo-400' : 'bg-zinc-400 dark:bg-zinc-600'}`}
                        style={{ width: `${(b.volume / maxVol) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      <Card title="Cumulative volume delta (estimate)">
        {data && lastCvd && (
          <div className="space-y-3">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">{data.cvd.note}</p>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="CVD (latest)" value={fmt(lastCvd.cvd, 0)}
                tone={lastCvd.cvd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
              <Stat label="Change over last 5 bars" value={fmt(cvdTrend, 0)}
                tone={cvdTrend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
            </div>
          </div>
        )}
      </Card>

      <Card title="Needs a live feed">
        {data && (
          <div className="space-y-3 text-xs">
            {([
              ['Footprint (bid/ask volume per price)', data.footprint],
              ['Bid/ask depth imbalance', data.bid_ask_imbalance],
              ['Open interest analysis', data.open_interest],
            ] as const).map(([label, item]) => (
              <div key={label} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">{label}</p>
                <p className="mt-1 text-zinc-500">{item.available ? 'Available' : item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

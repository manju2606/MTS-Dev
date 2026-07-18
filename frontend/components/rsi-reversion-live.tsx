'use client'

// Live view for the RSI-14 Reversion strategy (oversold=20/overbought=80,
// SL 2.5%/target 5.0%/trailing stop 2.0%, 5-min candles) -- the AI Strategy
// Lab's #1 ranked, walk-forward-validated candidate for Natural Gas Mini
// specifically (see backend mcx_rsi_signal_service.py and
// domain/services/strategy_lab/rsi_reversion_live.py). v1.0 is long-only
// (the originally validated logic); v2.0 adds a symmetric short leg; v2.1/
// v2.2 add an ADX regime filter on top of v2.0 to fix its weaker per-trade
// expectancy -- see the AI Strategy Lab's "RSI Reversion (Backtest)" mode
// for the full comparison. Shared by the MCX page's "RSI Strategy" tab and
// the AI Strategy Lab page's "RSI Reversion (Live)" mode, so both stay in
// sync from one place. v2.2 is the current live default: new entries
// trigger an email/push alert, and a regime-filter block sends a
// once-daily informational notice (see scheduler.py's
// ng_rsi_v2_signal_check job) -- v1.0/v2.0/v2.1/v3.0 are display-only.

import { useEffect, useState } from 'react'
import { getNgRsiSignal, getNgHistory, getNgQuote } from '@/lib/api'
import type { NgRsiSignal, HistoryBar, ChartPeriod } from '@/lib/api'
import { PriceChart } from '@/components/price-chart'
import type { AILevels, IndicatorSeries } from '@/components/price-chart'

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }

const RSI_CHART_CONTRACT = 'NGMINI'
const RSI_CHART_PERIOD: ChartPeriod = '5m'

// Wilder's RSI, same smoothing convention as the backend's
// domain/services/strategy_lab/indicators.py -- computed client-side purely
// for the chart's oscillator sub-pane (the live-signal endpoint only
// returns the current point value, not a full series).
function computeRsiSeries(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return rsi
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

function fmtSignalDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}

// Compact live-status card -- also used standalone by the MCX chart tab
// (see mcx-view.tsx's NgChart), which fetches its own NgRsiSignal so it can
// stay in step with the chart's own poll cadence.
export function RsiReversionPanel({ signal, currentPrice }: { signal: NgRsiSignal | null; currentPrice?: number | null }) {
  if (!signal) {
    return (
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/10 dark:text-indigo-300">
        RSI-14 Reversion strategy (validated for Natural Gas Mini) — loading live signal…
      </div>
    )
  }

  const inPosition = signal.status === 'IN_POSITION' && signal.position
  const isLong = signal.direction === 'LONG'
  const entrySignalLabel = isLong ? 'BUY' : 'SELL'
  const last = signal.last_signal

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          RSI-14 Reversion {signal.version} (Live) — {signal.strategy}
        </p>
        <span
          className={cls(
            'rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white',
            inPosition ? (isLong ? 'bg-emerald-600' : 'bg-red-500') : 'bg-zinc-400',
          )}
        >
          {inPosition ? `${entrySignalLabel} — IN POSITION` : 'FLAT — WATCHING'}
        </span>
      </div>

      <p className="mb-3 text-[11px] text-zinc-400">
        Walk-forward validated, #1 ranked of 392 candidates tested for Natural Gas Mini (see AI Strategy Lab). RSI
        {signal.rsi != null ? <> currently <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{signal.rsi.toFixed(1)}</span></> : ' unavailable'} · as of {fmtSignalDateTime(signal.as_of)}.
      </p>

      {inPosition && signal.position ? (
        <>
          <p className={cls(
            'mb-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
            isLong ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
          )}>
            {entrySignalLabel} signal generated {signal.position.entry_time ? fmtSignalDateTime(signal.position.entry_time) : '—'} at ₹{signal.position.entry_price?.toFixed(2)}
          </p>
          {currentPrice != null && signal.position.entry_price != null && (() => {
            const dir = isLong ? 1 : -1
            const pts = (currentPrice - signal.position.entry_price) * dir
            const pct = (pts / signal.position.entry_price) * 100
            const positive = pts >= 0
            return (
              <p className={cls(
                'mb-2 rounded-lg px-2.5 py-1.5 text-xs font-bold',
                positive ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white',
              )}>
                Unrealized P&amp;L (LTP ₹{currentPrice.toFixed(2)}): {positive ? '+' : ''}{pts.toFixed(2)} pts ({positive ? '+' : ''}{pct.toFixed(2)}%)
              </p>
            )
          })()}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <div className="flex justify-between sm:block"><dt className="text-zinc-500">Entry</dt><dd className="font-mono font-semibold">₹{signal.position.entry_price?.toFixed(2)}</dd></div>
            <div className="flex justify-between sm:block"><dt className="text-zinc-500">Stop Loss</dt><dd className="font-mono font-semibold text-red-500">₹{signal.position.stop_loss?.toFixed(2)}</dd></div>
            <div className="flex justify-between sm:block"><dt className="text-zinc-500">Target</dt><dd className="font-mono font-semibold text-emerald-600">₹{signal.position.target?.toFixed(2)}</dd></div>
            <div className="flex justify-between sm:block">
              <dt className="text-zinc-500">Trailing Stop</dt>
              <dd className="font-mono font-semibold">{signal.position.trailing_stop != null ? `₹${signal.position.trailing_stop.toFixed(2)}` : '—'}</dd>
            </div>
          </dl>
        </>
      ) : signal.blocked_by_time_filter || signal.blocked_by_regime_filter || signal.blocked_by_volatility_filter ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          An RSI entry condition just fired but was held back — {signal.blocked_by_time_filter
            ? 'an upcoming EIA Natural Gas Storage Report is within the no-entry window (Time Filter).'
            : signal.blocked_by_regime_filter
            ? 'the market is strongly trending right now, not ranging (Regime Filter).'
            : 'ATR is extremely elevated right now (Volatility Filter).'}
          {' '}You&apos;ve been notified.
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          No open position — waiting for RSI-14 to drop below 20 (oversold) to trigger a BUY entry
          {signal.version !== 'v1.0' ? ', or rise above 80 (overbought) to trigger a SELL entry' : ''}.
        </p>
      )}

      {last && (
        <p className="mt-3 text-[11px] text-zinc-400">
          Last signal: <span className={cls('font-semibold', last.type === 'BUY' ? 'text-emerald-600' : last.type === 'SELL' ? 'text-red-500' : 'text-zinc-500')}>{last.type}</span>
          {last.price != null ? ` at ₹${last.price.toFixed(2)}` : ''}
          {last.time ? ` · ${fmtSignalDateTime(last.time)}` : ''}
          {last.exit_reason ? ` · reason: ${last.exit_reason.replace('_', ' ')}` : ''}
        </p>
      )}
    </div>
  )
}

const RSI_TRADE_RESULT_STYLE = (pnl: number) => (pnl >= 0 ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white')

// Full tab/mode content: strategy explainer + version toggle + live status
// panel + recent trades log. Self-fetching (polls every 60s, refetches on
// version change) so any page can drop it in standalone.
export function RsiReversionLiveView() {
  const [version, setVersion] = useState<'v1.0' | 'v2.0' | 'v2.1' | 'v2.2' | 'v3.0'>('v2.2')
  const [signal, setSignal] = useState<NgRsiSignal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tradesOpen, setTradesOpen] = useState(true)
  const [chartOpen, setChartOpen] = useState(true)
  const [bars, setBars] = useState<HistoryBar[]>([])
  const [barsLoading, setBarsLoading] = useState(true)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setSignal(null)
    function load() {
      getNgRsiSignal(t, 100000, version).then(s => { setSignal(s); setError(null) }).catch(err => setError(err instanceof Error ? err.message : 'Failed to load RSI signal'))
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [version])

  // Candle history + live quote for the chart -- independent of `version`
  // (same NGMINI 5-min candles every version replays against), so this
  // doesn't re-fetch on a version toggle.
  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    let first = true
    function load() {
      getNgHistory(t, RSI_CHART_PERIOD, RSI_CHART_CONTRACT)
        .then(setBars)
        .catch(() => { if (first) setBars([]) })
        .finally(() => { setBarsLoading(false); first = false })
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgQuote(t, RSI_CHART_CONTRACT).then(q => setCurrentPrice(q.last_price)).catch(() => {})
    }
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [])

  const trades = signal?.recent_trades ?? []
  const closedCount = trades.length
  const wins = trades.filter(t => t.pnl >= 0).length

  const aiLevels: AILevels = signal?.status === 'IN_POSITION' && signal.position
    ? {
        signal: signal.position.direction === 'SHORT' ? 'SELL' : 'BUY',
        entry: signal.position.entry_price!,
        stopLoss: signal.position.trailing_stop ?? signal.position.stop_loss!,
        target: signal.position.target!,
        signalTime: signal.position.entry_time ? Math.floor(new Date(signal.position.entry_time).getTime() / 1000) : undefined,
      }
    : null

  const rsiIndicator: IndicatorSeries[] = (() => {
    if (bars.length < 15) return []
    const rsiVals = computeRsiSeries(bars.map(b => b.close), 14)
    const data: { time: number; value: number }[] = []
    bars.forEach((b, i) => { if (rsiVals[i] != null) data.push({ time: b.time, value: rsiVals[i] }) })
    return [{
      label: 'RSI-14',
      color: '#6366f1',
      data,
      refLines: [
        { value: 80, label: 'Overbought 80', color: '#ef4444' },
        { value: 20, label: 'Oversold 20', color: '#10b981' },
      ],
    }]
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setVersion('v1.0')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v1.0' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v1.0 (long-only, validated)
        </button>
        <button
          type="button"
          onClick={() => setVersion('v2.0')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v2.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v2.0 (long+short)
        </button>
        <button
          type="button"
          onClick={() => setVersion('v2.1')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v2.1' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v2.1 (+ regime filter, ADX&lt;25)
        </button>
        <button
          type="button"
          onClick={() => setVersion('v2.2')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v2.2' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v2.2 (+ regime filter, ADX&lt;30 — live, email alerts)
        </button>
        <button
          type="button"
          onClick={() => setVersion('v3.0')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v3.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v3.0 (+ Time &amp; Volatility filters)
        </button>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/10 dark:text-indigo-300">
        <p className="mb-2 font-semibold">RSI-14 Reversion (20/80, SL 2.5% / TG 5.0% / trail 2.0%) — Natural Gas Mini, 5-min candles</p>
        <p className="mb-1">
          <span className="font-semibold">Entry:</span> BUY the instant RSI-14 drops below 20 (oversold), while flat.
          {version !== 'v1.0' && <> v2.0+ adds a symmetric short leg: SELL the instant RSI-14 rises above 80 (overbought), while flat.</>}
          {(version === 'v2.1' || version === 'v2.2') && <> {version} also gates every entry through a Regime Filter (below) before it&apos;s taken.</>}
          {version === 'v3.0' && <> v3.0 also gates every entry through a Time Filter and a Volatility Filter (below) before it&apos;s taken.</>}
        </p>
        <p className="mb-1">
          <span className="font-semibold">Exit priority, checked every bar (only one fires per bar — stop/target beats the RSI exit on the same candle):</span>
        </p>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <span className="font-semibold">Stop-loss / trailing stop</span> — initial stop is entry ∓ 2.5% (below entry
            for a long, above entry for a short). Once in the trade, a trailing stop ratchets in the favorable direction
            every bar by 2.0% of the current close, but never gives back ground. The effective stop only tightens once
            price has moved enough to make the trailing level tighter than the fixed 2.5% stop. If the bar&apos;s
            low (long) or high (short) touches this effective stop, the trade closes there.
          </li>
          <li>
            <span className="font-semibold">Target</span> — entry ± 5.0% (above for a long, below for a short).
          </li>
          <li>
            <span className="font-semibold">RSI exit signal</span> — if neither stop nor target was hit: a long exits
            once RSI climbs back above 80; a short exits once RSI drops back below 20.
          </li>
        </ol>
        {(version === 'v2.1' || version === 'v2.2') && (
          <p className="mt-2">
            <span className="font-semibold">Regime Filter:</span> no new entries while ADX-14 ≥ {version === 'v2.1' ? '25' : '30'}{' '}
            (a strongly trending market, where mean-reversion tends to fight the trend and lose) — a signal held back
            for this reason still notifies you (once per day, not every 5-min poll), so you know an entry was
            skipped and why.
          </p>
        )}
        {version === 'v3.0' && (
          <p className="mt-2">
            <span className="font-semibold">Time Filter:</span> no new entries 30min before / 60min after the weekly
            EIA Natural Gas Storage Report (Thu 10:30 AM ET) — a signal held back for this reason still notifies you
            (once per day, not every 5-min poll), so you know an entry was skipped and why.{' '}
            <span className="font-semibold">Volatility Filter:</span> when ATR ≥ 1.3× its 20-bar average, the stop
            widens 1.5× (smaller risk-based position size, same total risk budget); at ATR ≥ 2.0× the entry is
            skipped entirely.
          </p>
        )}
        <p className="mt-2">
          {version === 'v1.0' ? (
            <>This is the exact long-only logic validated as the #1 ranked, walk-forward-stable candidate out of 392
            tested in the AI Strategy Lab, specifically for Natural Gas Mini — not extrapolated to full-size NG or any
            other contract. Display-only — v1.0 doesn&apos;t send email/push alerts.</>
          ) : version === 'v2.0' ? (
            <><strong>Not a validated profitable edge</strong> — a real backtest comparison (see AI Strategy Lab &gt;
            RSI Reversion (Backtest)) showed the short leg roughly doubles trade count and raw P&amp;L vs v1.0, but
            per-trade expectancy, profit factor, and max drawdown all came out worse. It was deployed here because a
            short leg was explicitly requested, not because it beat v1.0 — v2.2 is the validated fix for this
            weakness. Display-only — v2.0 doesn&apos;t send email/push alerts (v2.2 does).</>
          ) : version === 'v2.1' ? (
            <>Backtested improvement over v2.0&apos;s weak per-trade expectancy, with the best Monte Carlo
            tail-risk (lowest 95th-percentile drawdown) of the regime-filtered variants — but on a much thinner
            trade sample (~83% fewer trades than v2.0). Display-only — v2.2 was promoted to live instead for its
            larger, more walk-forward-consistent sample.</>
          ) : version === 'v2.2' ? (
            <><strong>Current live default</strong> for Natural Gas Mini — the most walk-forward-consistent variant
            tested (train vs test profit factor 2.46 vs 2.51, on a 25-trade sample), trading off some of v2.1&apos;s
            Monte Carlo tail-risk edge for that consistency and larger sample size. New entries send an email/push
            alert (every 5 min, see the scheduler); a Regime Filter block sends a once-daily informational
            notice.</>
          ) : (
            <><strong>Tested and rejected</strong> — a real backtest comparison found v3.0 underperforms v2.0 on
            every profitability metric (expectancy, profit factor, recovery factor), and Monte Carlo showed its
            95th-percentile drawdown was actually worse than v2.0&apos;s despite the Volatility Filter&apos;s whole
            purpose being to reduce it. Display-only, kept for reference/comparison, not recommended.</>
          )}
          {' '}This view is stateless: it replays the live candle history on every poll, so &quot;in position&quot;
          always reflects the real series rather than a stored flag.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

      <RsiReversionPanel signal={signal} currentPrice={currentPrice} />

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setChartOpen(o => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              className={cls('text-zinc-400 transition-transform', chartOpen ? 'rotate-90' : '')}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Chart (RSI-14, signal, SL/target)</span>
          </span>
          <span className="text-[11px] text-zinc-400">Natural Gas Mini · 5-min candles</span>
        </button>
        {chartOpen && (
          <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <PriceChart
              symbol="NATGASMINI"
              data={bars}
              period={RSI_CHART_PERIOD}
              onPeriodChange={() => {}}
              periods={[RSI_CHART_PERIOD]}
              loading={barsLoading}
              aiLevels={aiLevels}
              currentPrice={currentPrice}
              exchangeLabel="MCX"
              indicators={rsiIndicator}
            />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setTradesOpen(o => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              className={cls('text-zinc-400 transition-transform', tradesOpen ? 'rotate-90' : '')}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Recent Trades (this strategy)</span>
          </span>
          {closedCount > 0 ? (
            <span className="text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">{wins}/{closedCount}</span> profitable ·
              last ~15 days of 5-min candles
            </span>
          ) : (
            <span className="text-[11px] text-zinc-400">No completed trades in the lookback window yet</span>
          )}
        </button>
        {tradesOpen && (
          <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                  {['Dir', 'Entry Time', 'Entry', 'Exit Time', 'Exit', 'Reason', 'P&L'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-zinc-400">
                      No completed trades yet — a row appears here once a position exits (stop, target, or RSI signal).
                    </td>
                  </tr>
                ) : (
                  trades.map((t, i) => (
                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-2.5">
                        <span className={cls('rounded px-2 py-0.5 text-[10px] font-bold text-white', t.direction === 'LONG' ? 'bg-emerald-600' : 'bg-red-500')}>
                          {t.direction === 'LONG' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-500">{fmtSignalDateTime(t.entry_time)}</td>
                      <td className="px-3 py-2.5 font-mono">₹{t.entry_price.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-zinc-500">{fmtSignalDateTime(t.exit_time)}</td>
                      <td className="px-3 py-2.5 font-mono">₹{t.exit_price.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-zinc-500">{t.exit_reason.replace('_', ' ')}</td>
                      <td className="px-3 py-2.5">
                        <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', RSI_TRADE_RESULT_STYLE(t.pnl))}>
                          ₹{t.pnl.toFixed(2)} ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(1)}%)
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

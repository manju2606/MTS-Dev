'use client'

// Live view for the RSI-14 Reversion strategy (oversold=20/overbought=80,
// SL 2.5%/target 5.0%/trailing stop 2.0%, 5-min candles) -- the AI Strategy
// Lab's #1 ranked, walk-forward-validated candidate for Natural Gas Mini
// specifically (see backend mcx_rsi_signal_service.py and
// domain/services/strategy_lab/rsi_reversion_live.py). v1.0 is long-only
// (the originally validated logic); v2.0 adds a symmetric short leg -- see
// the AI Strategy Lab's "RSI Reversion (Backtest)" mode for the v1-vs-v2
// P&L/drawdown comparison. Shared by the MCX page's "RSI Strategy" tab and
// the AI Strategy Lab page's "RSI Reversion (Live)" mode, so both stay in
// sync from one place. v2.0 entries also trigger an email/push alert (see
// scheduler.py's ng_rsi_v2_signal_check job) -- v1.0 is display-only, same
// as before v2.0 existed.

import { useEffect, useState } from 'react'
import { getNgRsiSignal } from '@/lib/api'
import type { NgRsiSignal } from '@/lib/api'

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }

function fmtSignalDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}

// Compact live-status card -- also used standalone by the MCX chart tab
// (see mcx-view.tsx's NgChart), which fetches its own NgRsiSignal so it can
// stay in step with the chart's own poll cadence.
export function RsiReversionPanel({ signal }: { signal: NgRsiSignal | null }) {
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
      ) : signal.blocked_by_time_filter || signal.blocked_by_volatility_filter ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          An RSI entry condition just fired but was held back — {signal.blocked_by_time_filter
            ? 'an upcoming EIA Natural Gas Storage Report is within the no-entry window (Time Filter).'
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
  const [version, setVersion] = useState<'v1.0' | 'v2.0' | 'v3.0'>('v1.0')
  const [signal, setSignal] = useState<NgRsiSignal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tradesOpen, setTradesOpen] = useState(true)

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

  const trades = signal?.recent_trades ?? []
  const closedCount = trades.length
  const wins = trades.filter(t => t.pnl >= 0).length

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setVersion('v1.0')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v1.0' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v1.0 (long-only)
        </button>
        <button
          type="button"
          onClick={() => setVersion('v2.0')}
          className={cls(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
            version === 'v2.0' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
          )}
        >
          v2.0 (long+short, email alerts)
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
            other contract.</>
          ) : (
            <><strong>Not a validated profitable edge</strong> — a real backtest comparison (see AI Strategy Lab &gt;
            RSI Reversion (Backtest)) showed the {version === 'v2.0' ? 'short leg' : 'long+short base'} roughly
            doubles trade count and raw P&amp;L vs v1.0, but per-trade expectancy, profit factor, and max drawdown
            all came out worse. {version === 'v3.0' && "The Time/Volatility filters haven't been separately backtested "}
            It&apos;s live here because it was asked for, not because it beat v1.0 — check the backtest comparison
            before trusting it more than the long-only baseline. New entries also send an email/push alert (every 5
            min, see the scheduler); v1.0 is display-only.</>
          )}
          {' '}This view is stateless: it replays the live candle history on every poll, so &quot;in position&quot;
          always reflects the real series rather than a stored flag.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

      <RsiReversionPanel signal={signal} />

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

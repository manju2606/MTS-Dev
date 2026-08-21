'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import type { AILevels, RefLine } from '@/components/price-chart'
import {
  getNgHistory,
  getGasStrategyScore, getGasStrategyBacktest, getGasStrategySignals, getGasStrategyRiskStatus,
} from '@/lib/api'
import type {
  ChartPeriod, HistoryBar, GasStrategyScore, GasStrategyBacktest, GasStrategySignalsResponse,
  GasRiskStatus,
} from '@/lib/api'
import {
  CollapsibleCard, CategoryRow, SIGNAL_RESULT_STYLE, fmtSignalDateTime, cls, pnlColor,
} from '../metals/metals-view'

const GAS_VERDICT_STYLE: Record<GasStrategyScore['verdict'], string> = {
  STRONG: 'bg-emerald-600 text-white',
  TRADE: 'bg-indigo-600 text-white',
  WATCH: 'bg-amber-500 text-white',
  NO_TRADE: 'bg-zinc-400 text-white',
}

const SUB_NAV = [
  { href: '/mcx/ngmini', label: 'Live Signal' },
  { href: '/mcx/ngmini/history', label: 'History' },
  { href: '/mcx/ngmini/monitoring', label: 'Monitoring' },
]

export function NgMiniSubNav({ active }: { active: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link
        href="/mcx"
        className="mr-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        ← Natural Gas
      </Link>
      {SUB_NAV.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={
            active === item.label
              ? 'rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white'
              : 'rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
          }
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

// ── Chart ──────────────────────────────────────────────────────────────────

export function GasPriceChart({ score }: { score: GasStrategyScore }) {
  const [period, setPeriod] = useState<ChartPeriod>('15m')
  const [bars, setBars] = useState<HistoryBar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true)
    let first = true
    function load() {
      getNgHistory(t, period, 'NGMINI')
        .then(setBars)
        .catch(() => { if (first) setBars([]) })
        .finally(() => { setLoading(false); first = false })
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [period])

  const aiLevels: AILevels = {
    signal: score.verdict === 'NO_TRADE' ? 'HOLD' : score.direction,
    entry: score.entry.entry_price,
    stopLoss: score.entry.stop_loss,
    target: score.entry.target_1,
  }

  const refLines: RefLine[] = [
    { price: score.entry.target_2, label: 'T2', color: '#059669' },
    ...(score.prev_day
      ? [
          { price: score.prev_day.high, label: 'PDH', color: '#3b82f6' },
          { price: score.prev_day.low, label: 'PDL', color: '#3b82f6' },
          { price: score.prev_day.close, label: 'PDC', color: '#9333ea' },
        ]
      : []),
  ]

  return (
    <div className="space-y-2">
      <PriceChart
        symbol="NGMINI"
        data={bars}
        period={period}
        onPeriodChange={setPeriod}
        loading={loading}
        aiLevels={aiLevels}
        currentPrice={score.price}
        exchangeLabel="MCX"
        refLines={refLines}
      />
      <p className="text-[11px] text-zinc-400">
        Entry/SL/T1 from the current {score.direction} score above; T2 and previous-day PDH/PDL/PDC shown as
        reference lines. Chart defaults to 15M (the strategy&apos;s own setup timeframe) — switch freely.
      </p>
    </div>
  )
}

// ── Reasoning ────────────────────────────────────────────────────────────────

export function GasReasoningCard({ reasoning }: { reasoning: GasStrategyScore['reasoning'] }) {
  const [speaking, setSpeaking] = useState(false)
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  function toggleSpeak() {
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    window.speechSynthesis.cancel()
    const text = [
      `1H trend: ${reasoning.trend_reason}`,
      `15M setup: ${reasoning.setup_reason}`,
      `5M confirmation: ${reasoning.confirmation_reason}`,
      `Alternative scenario: ${reasoning.alternative_scenario}`,
      `Invalidation level: ${reasoning.invalidation_level}`,
    ].join('. ')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  const rows: { label: string; text: string }[] = [
    { label: '1H Trend', text: reasoning.trend_reason },
    { label: '15M Setup', text: reasoning.setup_reason },
    { label: '5M Confirmation', text: reasoning.confirmation_reason },
  ]

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">AI Analysis</p>
        {speechSupported && (
          <button
            onClick={toggleSpeak}
            className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
          >
            {speaking ? 'Stop' : 'Read aloud'}
          </button>
        )}
      </div>
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.label}>
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{r.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{r.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Alternative Scenario</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{reasoning.alternative_scenario}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">Invalidation Level</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{reasoning.invalidation_level}</p>
        </div>
      </div>
    </div>
  )
}

// ── Risk status ──────────────────────────────────────────────────────────────

export function GasRiskStatusCard({ status }: { status: GasRiskStatus | null }) {
  if (!status) return null
  return (
    <div className={cls(
      'rounded-xl border p-5',
      status.can_trade
        ? 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
        : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
    )}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Today&apos;s Risk Status ({status.date})
        </p>
        <span className={cls(
          'rounded-full px-2.5 py-0.5 text-[10px] font-bold',
          status.can_trade ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white',
        )}>
          {status.can_trade ? 'TRADING ALLOWED' : 'BLOCKED'}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Trades Today</dt>
          <dd className="font-mono font-semibold">{status.trade_count}/{status.max_trades_per_day}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Realized P&amp;L</dt>
          <dd className={cls('font-mono font-semibold', pnlColor(status.realized_pnl))}>₹{status.realized_pnl.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Consecutive Losses</dt>
          <dd className="font-mono font-semibold">{status.consecutive_losses}/{status.max_consecutive_losses}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Daily Loss Limit</dt>
          <dd className="font-mono font-semibold">₹{status.max_daily_loss_amount.toFixed(2)}</dd>
        </div>
      </dl>
      {status.blocked_reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-red-700 dark:text-red-400">
          {status.blocked_reasons.map(r => <li key={r}>• {r}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400 dark:border-zinc-800">
        <span>{status.session_note}</span>
        <span>·</span>
        <span className={status.expiry_protected ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
          {status.expiry_note}
        </span>
      </div>
    </div>
  )
}

// ── Main strategy panel ────────────────────────────────────────────────────

export function GasStrategyPanel({ showBacktest = true, showSignalsTable = true }: {
  showBacktest?: boolean
  showSignalsTable?: boolean
}) {
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY')
  const [capital, setCapital] = useState('100000')
  const [riskPct, setRiskPct] = useState('0.5')
  const [score, setScore] = useState<GasStrategyScore | null>(null)
  const [riskStatus, setRiskStatus] = useState<GasRiskStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const run = useCallback(async () => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    try {
      const [s, rs] = await Promise.all([
        getGasStrategyScore(t, direction, 'NGMINI', parseFloat(capital) || 100000, parseFloat(riskPct) || 0.5),
        getGasStrategyRiskStatus(t, 'NGMINI'),
      ])
      setScore(s); setRiskStatus(rs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute MTS Natural Gas Strategy score')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction])

  useEffect(() => {
    run()
    if (!autoRefresh) return
    const id = setInterval(run, 180_000)
    return () => clearInterval(id)
  }, [run, autoRefresh])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/10 dark:text-indigo-300">
        MTS Natural Gas Strategy — multi-timeframe (1H trend / 15M setup / 5M entry) score for NGMINI,
        modeled on the same scoring engine as MTS Gold/Silver Strategy. 1H trend is a hard gate: a neutral
        or opposing hourly trend forces NO TRADE regardless of how the lower timeframes score.
      </div>

      <GasRiskStatusCard status={riskStatus} />

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
            className="w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Risk %</label>
          <input type="number" step="0.1" value={riskPct} onChange={e => setRiskPct(e.target.value)} onBlur={run}
            className="w-20 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
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

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

      {score && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-4">
              <div className="text-5xl font-bold font-mono text-zinc-900 dark:text-zinc-50">{score.score_pct.toFixed(1)}</div>
              <div>
                <span className={cls('rounded-full px-3 py-1 text-xs font-bold', GAS_VERDICT_STYLE[score.verdict])}>
                  {score.signal_label} ({score.score_pct.toFixed(0)})
                </span>
                <p className="mt-1 text-[11px] text-zinc-400">
                  1H trend: {score.trend} {score.trend_matches_direction ? '(matches direction)' : '(does not match — forces NO TRADE)'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              {score.contract} · {direction} · price ₹{score.price.toFixed(2)} · {score.points_earned}/{score.points_available} pts ·
              candles used: 1H={score.candles_used['1h']} 15M={score.candles_used['15m']} 5M={score.candles_used['5m']}
            </p>
          </div>

          <GasPriceChart score={score} />

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Category Breakdown</p>
            {score.categories.map(cat => <CategoryRow key={cat.name} cat={cat} />)}
          </div>

          <GasReasoningCard reasoning={score.reasoning} />

          {score.prev_day && (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Previous Day Levels</p>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div><dt className="text-zinc-500">PDH</dt><dd className="font-mono font-semibold">₹{score.prev_day.high.toFixed(2)}</dd></div>
                <div><dt className="text-zinc-500">PDL</dt><dd className="font-mono font-semibold">₹{score.prev_day.low.toFixed(2)}</dd></div>
                <div><dt className="text-zinc-500">PDC</dt><dd className="font-mono font-semibold">₹{score.prev_day.close.toFixed(2)}</dd></div>
              </dl>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Entry / Exit ({score.entry.atr_multiplier}×ATR)
              </p>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">Entry</dt><dd className="font-mono font-semibold">₹{score.entry.entry_price.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Stop Loss</dt><dd className="font-mono font-semibold text-red-500">₹{score.entry.stop_loss.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Target 1 (50%, 1R)</dt><dd className="font-mono font-semibold text-emerald-600">₹{score.entry.target_1.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Target 2 (50%, 2R)</dt><dd className="font-mono font-semibold text-emerald-600">₹{score.entry.target_2.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Risk:Reward</dt><dd className="font-mono">{score.entry.risk_reward != null ? `1:${score.entry.risk_reward.toFixed(2)}` : '—'}</dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-zinc-400">Stop moves to breakeven after target 1 hits.</p>
              <p className="mt-1 text-[11px] text-zinc-400">As of {fmtSignalDateTime(score.entry.as_of)} IST</p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Position Sizing</p>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">Capital</dt><dd className="font-mono">₹{score.position_sizing.capital.toLocaleString('en-IN')}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Risk %</dt><dd className="font-mono">{score.position_sizing.risk_pct}%</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Risk Amount</dt><dd className="font-mono font-semibold">₹{score.position_sizing.risk_amount.toLocaleString('en-IN')}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Suggested Quantity</dt><dd className="font-mono font-bold">{score.position_sizing.suggested_quantity}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {showBacktest && <GasBacktestCard />}
      {showSignalsTable && <GasStrategySignalsTable />}
    </div>
  )
}

export function GasBacktestCard() {
  const [bt, setBt] = useState<GasStrategyBacktest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    try {
      setBt(await getGasStrategyBacktest(t, 'NGMINI'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run backtest')
    } finally {
      setLoading(false)
    }
  }

  const m = bt?.full_metrics

  return (
    <CollapsibleCard
      title="Backtest — Your Real Signal History"
      defaultOpen={false}
      subtitle={<span className="text-[11px] text-zinc-400">{bt ? `${bt.total_trades} closed signals` : 'Not run yet'}</span>}
    >
      <div className="p-4">
        <p className="mb-3 text-[11px] text-zinc-400">
          Backtests this account&apos;s own real logged signals for NGMINI (not a historical-candle
          re-simulation — MCX Natural Gas is a monthly-expiry contract with no continuous price series to
          replay). Results only reflect signals generated since this strategy started running on your account.
        </p>
        <button onClick={run} disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {loading ? 'Running…' : bt ? 'Re-run Backtest' : 'Run Backtest'}
        </button>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        {m && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div><dt className="text-zinc-500">Total Trades</dt><dd className="font-mono font-semibold">{m.total_trades}</dd></div>
            <div><dt className="text-zinc-500">Win Rate</dt><dd className="font-mono font-semibold">{m.win_rate_pct.toFixed(1)}%</dd></div>
            <div><dt className="text-zinc-500">Profit Factor</dt><dd className="font-mono font-semibold">{m.profit_factor.toFixed(2)}</dd></div>
            <div><dt className="text-zinc-500">Net P&amp;L</dt><dd className={cls('font-mono font-semibold', pnlColor(m.net_pnl))}>₹{m.net_pnl.toFixed(2)}</dd></div>
            <div><dt className="text-zinc-500">Max Drawdown</dt><dd className="font-mono font-semibold">{m.max_drawdown_pct.toFixed(1)}%</dd></div>
            <div><dt className="text-zinc-500">Avg R (Expectancy)</dt><dd className="font-mono font-semibold">₹{m.expectancy.toFixed(2)}</dd></div>
            <div><dt className="text-zinc-500">Long Trades</dt><dd className="font-mono font-semibold">{m.long_trades ?? '—'} ({m.long_win_rate_pct?.toFixed(1) ?? '—'}% win)</dd></div>
            <div><dt className="text-zinc-500">Short Trades</dt><dd className="font-mono font-semibold">{m.short_trades ?? '—'} ({m.short_win_rate_pct?.toFixed(1) ?? '—'}% win)</dd></div>
          </dl>
        )}
        {bt && bt.total_trades === 0 && (
          <p className="mt-4 text-xs text-zinc-400">No closed signals yet — results will appear once signals from this strategy have resolved.</p>
        )}
      </div>
    </CollapsibleCard>
  )
}

export function GasStrategySignalsTable() {
  const [data, setData] = useState<GasStrategySignalsResponse | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getGasStrategySignals(t, 'NGMINI', 50).then(setData).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const acc = data?.accuracy

  return (
    <CollapsibleCard
      title="MTS Natural Gas Strategy Signals"
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
              {['Generated', 'Direction', 'Entry', 'SL', 'T1', 'T2', 'T1 Hit', 'Result', 'P&L'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {!data || data.signals.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-400">
                  No signals yet — a new row is logged automatically whenever the MTS Natural Gas Strategy
                  score hits TRADE or STRONG, one open signal per direction at a time.
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
                  <td className="px-3 py-2.5 font-mono text-emerald-600">{s.target_2 != null ? `₹${s.target_2.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5">{s.target_1_hit ? '✓' : '—'}</td>
                  <td className="px-3 py-2.5">
                    {s.result ? (
                      <span className={cls('rounded-full px-2.5 py-0.5 text-[10px] font-bold', SIGNAL_RESULT_STYLE[s.result])}>{s.result}</span>
                    ) : (
                      <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                        {s.target_1_hit ? 'OPEN (T1 hit, breakeven stop)' : 'OPEN'}
                      </span>
                    )}
                  </td>
                  <td className={cls('px-3 py-2.5 font-mono font-semibold', s.pnl == null ? 'text-zinc-400' : pnlColor(s.pnl))}>
                    {s.pnl != null ? `₹${s.pnl.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800">
        Target 1 hit moves the stop to breakeven and keeps the signal open for target 2 (two-stage exit, 50%/50%).
        Closes WIN (target 2 or breakeven-after-T1), LOSS (original stop hit before T1), or EXPIRED after 5 trading
        days.
      </p>
    </CollapsibleCard>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NgMiniView() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">NG Mini — MTS Natural Gas Strategy</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Live multi-timeframe BUY/SELL signal for MCX Natural Gas Mini futures, with a plain-language
          explanation of why.
        </p>

        <div className="mt-6">
          <NgMiniSubNav active="Live Signal" />
          <GasStrategyPanel showBacktest={false} showSignalsTable={false} />
        </div>
      </div>
    </div>
  )
}

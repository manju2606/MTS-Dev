'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { PriceChart, type RefLine, type AILevels } from '@/components/price-chart'
import { getLiquidityFlow } from '@/lib/api'
import type { LiquidityFlowResult } from '@/lib/api'
import { BacktestPanel, MtfPanel, OrderFlowPanel, ScannerPanel } from './liquidity-flow-panels'

const DEFAULT_SYMBOL = 'RELIANCE'

type TabKey = 'analysis' | 'mtf' | 'backtest' | 'scanner' | 'orderflow'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'analysis', label: 'Analysis' },
  { key: 'mtf', label: 'Multi-timeframe' },
  { key: 'backtest', label: 'Backtest' },
  { key: 'scanner', label: 'Market scanner' },
  { key: 'orderflow', label: 'Order flow' },
]

const SIGNAL_STYLE: Record<string, string> = {
  BUY:  'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
  SELL: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800',
  HOLD: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
}

const EVENT_LABEL: Record<string, string> = {
  BOS_UP: 'BOS ↑', BOS_DOWN: 'BOS ↓', CHOCH_UP: 'CHoCH ↑', CHOCH_DOWN: 'CHoCH ↓',
}

function fmtPrice(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(unixSeconds: number, interval: '1d' | '1h'): string {
  const d = new Date(unixSeconds * 1000)
  return interval === '1h'
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function Panel({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {hint && <span className="text-[10px] text-zinc-400">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-zinc-400">{text}</p>
}

export default function LiquidityFlowView() {
  const router = useRouter()
  const enabled = process.env.NEXT_PUBLIC_ENABLE_LIQUIDITY_AI !== 'false'

  const [input, setInput] = useState(DEFAULT_SYMBOL)
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL)
  const [interval, setInterval] = useState<'1d' | '1h'>('1d')
  const [data, setData] = useState<LiquidityFlowResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('analysis')

  const run = useCallback(async (sym: string, iv: '1d' | '1h') => {
    const token = localStorage.getItem('mts_token')
    if (!token) { router.replace('/login'); return }
    setLoading(true)
    setError(null)
    try {
      setData(await getLiquidityFlow(token, sym, iv))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (!enabled) return
    // Deferred so the loading state is not set synchronously inside the effect body.
    const id = setTimeout(() => { run(symbol, interval) }, 0)
    return () => clearTimeout(id)
  }, [enabled, symbol, interval, run])

  const refLines: RefLine[] = useMemo(() => {
    if (!data) return []
    const lines: RefLine[] = []
    data.order_blocks.filter(b => b.status === 'active').forEach((b, i) => {
      const color = b.side === 'bullish' ? '#10b981' : '#ef4444'
      lines.push({ price: b.top, label: `${b.side === 'bullish' ? 'Bull' : 'Bear'} OB ${i + 1} top`, color })
      lines.push({ price: b.bottom, label: `${b.side === 'bullish' ? 'Bull' : 'Bear'} OB ${i + 1} low`, color })
    })
    data.liquidity_pools.forEach(p => {
      lines.push({
        price: p.level,
        label: `${p.side === 'buy_side' ? 'BSL' : 'SSL'} ×${p.touches}`,
        color: p.side === 'buy_side' ? '#f59e0b' : '#3b82f6',
      })
    })
    return lines
  }, [data])

  const aiLevels: AILevels = useMemo(() => {
    if (!data) return null
    const r = data.recommendation
    return { signal: r.signal, entry: r.entry_price, stopLoss: r.stop_loss, target: r.target }
  }, [data])

  if (!enabled) {
    return (
      <>
        <NavBar active="Liquidity Flow" />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-zinc-500">Liquidity Flow is turned off for this deployment.</p>
        </main>
      </>
    )
  }

  const rec = data?.recommendation
  const sortedEvents = data ? [...data.structure_events].reverse().slice(0, 8) : []
  const activeOBs = data ? data.order_blocks.filter(b => b.status === 'active') : []
  const mitigatedOBs = data ? data.order_blocks.filter(b => b.status !== 'active') : []
  const buyPools = data ? data.liquidity_pools.filter(p => p.side === 'buy_side') : []
  const sellPools = data ? data.liquidity_pools.filter(p => p.side === 'sell_side') : []

  return (
    <>
      <NavBar active="Liquidity Flow" />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Liquidity Flow</h1>
            <p className="text-xs text-zinc-500">
              Smart Money Concepts on NSE daily or hourly candles: structure breaks, order blocks, liquidity pools and sweeps.
            </p>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault()
              const s = input.trim().toUpperCase()
              if (s) setSymbol(s)
            }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Symbol e.g. RELIANCE"
              aria-label="Symbol"
              className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <select
              value={interval}
              onChange={e => setInterval(e.target.value as '1d' | '1h')}
              aria-label="Timeframe"
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="1d">Daily</option>
              <option value="1h">1 Hour</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? 'Analysing…' : 'Analyse'}
            </button>
          </form>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label="Liquidity Flow sections">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                tab === t.key
                  ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'mtf' && <MtfPanel symbol={symbol} />}
        {tab === 'backtest' && <BacktestPanel symbol={symbol} interval={interval} />}
        {tab === 'scanner' && <ScannerPanel />}
        {tab === 'orderflow' && <OrderFlowPanel symbol={symbol} interval={interval} />}

        {tab === 'analysis' && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {tab === 'analysis' && data && rec && (
          <>
            {/* Recommendation */}
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-1">
                <div className="flex items-center justify-between">
                  <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{data.symbol.replace(/\.(NS|BO)$/, '')}</p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${SIGNAL_STYLE[rec.signal]}`}>
                    {rec.signal}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Last close ₹{fmtPrice(data.last_close)} · ATR {fmtPrice(data.atr)} · Trend {data.trend}
                </p>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Confidence</span>
                    <span>{Math.round(rec.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${rec.signal === 'SELL' ? 'bg-red-500' : rec.signal === 'BUY' ? 'bg-emerald-500' : 'bg-zinc-400'}`}
                      style={{ width: `${Math.round(rec.confidence * 100)}%` }}
                    />
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div><dt className="text-zinc-400">Entry</dt><dd className="font-semibold text-zinc-900 dark:text-zinc-100">₹{fmtPrice(rec.entry_price)}</dd></div>
                  <div><dt className="text-zinc-400">Stop loss</dt><dd className="font-semibold text-red-600 dark:text-red-400">₹{fmtPrice(rec.stop_loss)}</dd></div>
                  <div><dt className="text-zinc-400">Target</dt><dd className="font-semibold text-emerald-600 dark:text-emerald-400">₹{fmtPrice(rec.target)}</dd></div>
                  <div><dt className="text-zinc-400">Reward : risk</dt><dd className="font-semibold text-zinc-900 dark:text-zinc-100">{rec.risk_reward_ratio.toFixed(2)}</dd></div>
                  <div className="col-span-2"><dt className="text-zinc-400">Holding period</dt><dd className="font-semibold text-zinc-900 dark:text-zinc-100">{rec.holding_period}</dd></div>
                </dl>

                <p className="mt-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{rec.explanation}</p>
                <p className="mt-3 text-[10px] text-zinc-400">
                  Scores: bullish {rec.bullish_score.toFixed(2)} · bearish {rec.bearish_score.toFixed(2)} · net {rec.net_score.toFixed(2)}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2">
                <PriceChart
                  symbol={data.symbol}
                  data={data.candles}
                  period="1D"
                  onPeriodChange={() => {}}
                  loading={loading}
                  aiLevels={aiLevels}
                  currentPrice={data.last_close}
                  exchangeLabel="NSE"
                  refLines={refLines}
                  periods={['1D']}
                  periodBucketSeconds={{ '1D': data.interval === '1h' ? 3600 : 86400 }}
                />
              </div>
            </section>

            {/* Analysis panels */}
            <section className="grid gap-4 md:grid-cols-2">
              <Panel title="Structure (BOS / CHoCH)" hint="Latest first">
                {sortedEvents.length === 0 ? <Empty text="No structure breaks in the analysed window." /> : (
                  <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                    {sortedEvents.map(e => (
                      <li key={`${e.kind}-${e.index}`} className="flex items-center justify-between py-1.5">
                        <span className={`font-semibold ${e.kind.endsWith('UP') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {EVENT_LABEL[e.kind] ?? e.kind}
                        </span>
                        <span className="text-zinc-500">level ₹{fmtPrice(e.level)} · close ₹{fmtPrice(e.close)}</span>
                        <span className="text-zinc-400">{fmtTime(e.time, data.interval)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Order blocks" hint={`${activeOBs.length} active · ${mitigatedOBs.length} mitigated`}>
                {data.order_blocks.length === 0 ? <Empty text="No order blocks found." /> : (
                  <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                    {data.order_blocks.map(b => (
                      <li key={`${b.index}-${b.side}`} className="flex items-center justify-between py-1.5">
                        <span className={`font-semibold ${b.side === 'bullish' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {b.side === 'bullish' ? 'Bullish' : 'Bearish'} OB
                        </span>
                        <span className="text-zinc-500">₹{fmtPrice(b.bottom)} – ₹{fmtPrice(b.top)}</span>
                        <span className={b.status === 'active' ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400 line-through'}>
                          {b.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Liquidity pools" hint="Equal highs / lows and latest swings">
                {data.liquidity_pools.length === 0 ? <Empty text="No unbroken liquidity pools." /> : (
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="mb-1 font-semibold text-amber-600 dark:text-amber-400">Buy-side (above)</p>
                      {buyPools.length === 0 ? <Empty text="None" /> : buyPools.map(p => (
                        <p key={`b-${p.level}`} className="py-0.5 text-zinc-700 dark:text-zinc-200">
                          ₹{fmtPrice(p.level)} <span className="text-zinc-400">×{p.touches}</span>
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-blue-600 dark:text-blue-400">Sell-side (below)</p>
                      {sellPools.length === 0 ? <Empty text="None" /> : sellPools.map(p => (
                        <p key={`s-${p.level}`} className="py-0.5 text-zinc-700 dark:text-zinc-200">
                          ₹{fmtPrice(p.level)} <span className="text-zinc-400">×{p.touches}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Liquidity sweeps" hint="Last 20 bars">
                {data.sweeps.length === 0 ? <Empty text="No sweeps in the last 20 bars." /> : (
                  <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                    {[...data.sweeps].reverse().map(s => (
                      <li key={`${s.index}-${s.side}`} className="flex items-center justify-between py-1.5">
                        <span className={`font-semibold ${s.side === 'bullish' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {s.side === 'bullish' ? 'Sell-side swept (bullish)' : 'Buy-side swept (bearish)'}
                        </span>
                        <span className="text-zinc-500">level ₹{fmtPrice(s.level)} · wick ₹{fmtPrice(s.wick_extreme)}</span>
                        <span className="text-zinc-400">{fmtTime(s.time, data.interval)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </section>

            <p className="text-[11px] leading-relaxed text-zinc-400">{data.disclaimer}</p>
          </>
        )}

        {tab === 'analysis' && !data && !error && loading && <p className="text-sm text-zinc-500">Loading analysis…</p>}
      </main>
    </>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getStrategyMeta, listStrategies, createStrategy, deleteStrategy,
  toggleStrategy, backtestStrategy, searchStocks,
} from '@/lib/api'
import type { Strategy, StrategyCondition, StrategyBacktestResult, StrategyMeta, StockSearchResult } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const STRATEGIES_CACHE_KEY = 'strategy:list'

// ── Condition row ──────────────────────────────────────────────────────────────

const INDICATOR_LABELS: Record<string, string> = {
  rsi: 'RSI (14)',
  macd: 'MACD',
  macd_hist: 'MACD Histogram',
  sma20_ratio: 'Price vs SMA20 (%)',
  sma50_ratio: 'Price vs SMA50 (%)',
  bb_position: 'Bollinger Band Position',
  atr_pct: 'ATR %',
  vol_ratio: 'Volume Ratio',
  price: 'Price (₹)',
  volume: 'Volume',
}

const OPERATOR_LABELS: Record<string, string> = {
  '<': '< (below)',
  '>': '> (above)',
  '<=': '≤',
  '>=': '≥',
  '==': '= (equals)',
  crosses_above: 'Crosses Above',
  crosses_below: 'Crosses Below',
}

function ConditionRow({
  cond, meta, onChange, onRemove,
}: {
  cond: StrategyCondition
  meta: StrategyMeta
  onChange: (c: StrategyCondition) => void
  onRemove: () => void
}) {
  const sel = 'rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 focus:border-indigo-400 focus:outline-none cursor-pointer'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-400">IF</span>
      <select className={sel} value={cond.indicator} onChange={e => onChange({ ...cond, indicator: e.target.value })}>
        {meta.indicators.map(ind => (
          <option key={ind} value={ind}>{INDICATOR_LABELS[ind] ?? ind}</option>
        ))}
      </select>
      <select className={sel} value={cond.operator} onChange={e => onChange({ ...cond, operator: e.target.value })}>
        {meta.operators.map(op => (
          <option key={op} value={op}>{OPERATOR_LABELS[op] ?? op}</option>
        ))}
      </select>
      <input
        type="number" step="any"
        value={cond.value}
        onChange={e => onChange({ ...cond, value: parseFloat(e.target.value) || 0 })}
        className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 focus:border-indigo-400 focus:outline-none"
      />
      <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs">✕</button>
    </div>
  )
}

// ── Strategy card ──────────────────────────────────────────────────────────────

function StrategyCard({
  strategy, meta, tokenRef,
  onDeleted, onToggled,
}: {
  strategy: Strategy
  meta: StrategyMeta
  tokenRef: React.RefObject<string>
  onDeleted: () => void
  onToggled: (s: Strategy) => void
}) {
  const [expanding, setExpanding] = useState(false)
  const [btSymbol, setBtSymbol] = useState('')
  const [btPeriod, setBtPeriod] = useState('1y')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const [selectedSym, setSelectedSym] = useState('')
  const [result, setResult] = useState<StrategyBacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (btSymbol.length < 2) { setSuggestions([]); return }
    const id = setTimeout(async () => {
      try { setSuggestions(await searchStocks(tokenRef.current, btSymbol)) }
      catch { setSuggestions([]) }
    }, 300)
    return () => clearTimeout(id)
  }, [btSymbol, tokenRef])

  async function runBacktest() {
    const sym = selectedSym || btSymbol
    if (!sym) return
    setLoading(true); setErr(null); setResult(null); setSuggestions([])
    try {
      setResult(await backtestStrategy(tokenRef.current, strategy.id, sym, btPeriod))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Backtest failed') }
    finally { setLoading(false) }
  }

  const isUp = (strategy.action === 'BUY')
  const retColor = result
    ? result.total_return_pct >= 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400'
    : ''

  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-900 ${strategy.is_active ? 'border-zinc-200 dark:border-zinc-800' : 'border-zinc-100 opacity-60 dark:border-zinc-800'}`}>
      <div className="flex items-start justify-between p-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isUp ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300'}`}>
              {strategy.action}
            </span>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{strategy.name}</p>
          </div>
          {strategy.description && (
            <p className="text-xs text-zinc-400 mb-2">{strategy.description}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {strategy.conditions.map((c, i) => (
              <span key={i} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {INDICATOR_LABELS[c.indicator] ?? c.indicator} {OPERATOR_LABELS[c.operator] ?? c.operator} {c.value}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => onToggled(strategy)}
            className={`text-xs font-medium ${strategy.is_active ? 'text-amber-600 hover:text-amber-800 dark:text-amber-400' : 'text-emerald-600 hover:text-emerald-800 dark:text-emerald-400'}`}
          >
            {strategy.is_active ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => setExpanding(e => !e)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            {expanding ? 'Close' : 'Backtest'}
          </button>
          <button onClick={onDeleted} className="text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      </div>

      {expanding && (
        <div className="border-t border-zinc-100 p-5 dark:border-zinc-800">
          <p className="mb-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Run Backtest</p>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[180px]">
              <input
                value={btSymbol}
                onChange={e => { setBtSymbol(e.target.value); setSelectedSym('') }}
                onKeyDown={e => e.key === 'Enter' && runBacktest()}
                placeholder="Symbol (e.g. RELIANCE)"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              />
              {suggestions.length > 0 && (
                <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  {suggestions.slice(0, 6).map(s => (
                    <button key={s.symbol} onClick={() => { setBtSymbol(s.symbol.replace(/\.(NS|BO)$/, '')); setSelectedSym(s.symbol); setSuggestions([]) }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700">
                      <span className="font-semibold">{s.symbol.replace(/\.(NS|BO)$/, '')}</span>
                      <span className="text-zinc-400 truncate max-w-[160px]">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={btPeriod}
              onChange={e => setBtPeriod(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none"
            >
              {['1y', '2y', '3y'].map(p => <option key={p} value={p}>{p === '1y' ? '1 Year' : p === '2y' ? '2 Years' : '3 Years'}</option>)}
            </select>
            <button
              onClick={runBacktest}
              disabled={loading || (!selectedSym && !btSymbol)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {loading ? 'Running…' : 'Run'}
            </button>
          </div>

          {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}

          {result && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4 sm:grid-cols-6">
                {[
                  { label: 'Trades', value: result.total_trades },
                  { label: 'Win Rate', value: `${result.win_rate_pct}%` },
                  { label: 'Return', value: `${result.total_return_pct > 0 ? '+' : ''}${result.total_return_pct}%`, color: retColor },
                  { label: 'Max DD', value: `-${result.max_drawdown_pct}%`, color: 'text-red-500 dark:text-red-400' },
                  { label: 'Sharpe', value: result.sharpe_ratio.toFixed(2) },
                  { label: 'Winners', value: `${result.winners}W / ${result.losers}L` },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800">
                    <p className="text-[10px] text-zinc-400">{label}</p>
                    <p className={`text-xs font-bold mt-0.5 ${color ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Recent trades */}
              {result.trades.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        {['Date In', 'Date Out', 'Entry ₹', 'Exit ₹', 'P&L', 'Return'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-10).reverse().map((t, i) => (
                        <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                          <td className="px-3 py-2 text-zinc-500">{t.date_in}</td>
                          <td className="px-3 py-2 text-zinc-500">{t.date_out}</td>
                          <td className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-200">₹{t.entry.toFixed(2)}</td>
                          <td className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-200">₹{t.exit.toFixed(2)}</td>
                          <td className={`px-3 py-2 font-semibold ${t.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
                          </td>
                          <td className={`px-3 py-2 font-semibold ${t.pnl_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create strategy form ───────────────────────────────────────────────────────

function CreateForm({ meta, tokenRef, onCreated }: {
  meta: StrategyMeta
  tokenRef: React.RefObject<string>
  onCreated: (s: Strategy) => void
}) {
  const [name, setName] = useState('')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [description, setDescription] = useState('')
  const [conditions, setConditions] = useState<StrategyCondition[]>([
    { indicator: 'rsi', operator: '<', value: 30 },
  ])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function addCondition() {
    setConditions(prev => [...prev, { indicator: 'rsi', operator: '>', value: 50 }])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || conditions.length === 0) { setErr('Name and at least one condition required'); return }
    setBusy(true); setErr(null)
    try {
      const s = await createStrategy(tokenRef.current, { name, action, conditions, description })
      onCreated(s)
      setName(''); setDescription('')
      setConditions([{ indicator: 'rsi', operator: '<', value: 30 }])
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed') }
    finally { setBusy(false) }
  }

  const inp = 'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50'

  return (
    <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Strategy</h2>
      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Strategy name" className={inp + ' sm:col-span-2'} />
        <select value={action} onChange={e => setAction(e.target.value as 'BUY' | 'SELL')}
          className={inp + ' cursor-pointer'}>
          <option value="BUY">BUY signal</option>
          <option value="SELL">SELL signal</option>
        </select>
      </div>

      <input value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)" className={inp + ' mb-4 w-full'} />

      {/* Conditions */}
      <div className="mb-4 space-y-2">
        {conditions.map((c, i) => (
          <ConditionRow
            key={i} cond={c} meta={meta}
            onChange={nc => setConditions(prev => prev.map((x, j) => j === i ? nc : x))}
            onRemove={() => setConditions(prev => prev.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={addCondition}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          + Add Condition
        </button>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
          {busy ? 'Creating…' : 'Create Strategy'}
        </button>
      </div>
    </form>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function StrategyView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [meta, setMeta] = useState<StrategyMeta | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (token: string) => {
    const [m, list] = await Promise.all([getStrategyMeta(token), listStrategies(token)])
    setMeta(m); setStrategies(list)
    writePageCache(STRATEGIES_CACHE_KEY, list)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    // Show the last-known strategy list instantly (from a previous
    // visit) instead of a blank spinner, then load() below fetches
    // fresh data in the background and overwrites both state and the
    // cache. Deferred a microtask so the setState isn't synchronous
    // within the effect body (react-hooks/set-state-in-effect).
    const cached = readPageCache<Strategy[]>(STRATEGIES_CACHE_KEY)
    if (cached) Promise.resolve().then(() => setStrategies(cached))
    load(t).catch(() => {})
  }, [router, load])

  async function handleDelete(id: string) {
    await deleteStrategy(tokenRef.current, id)
    setStrategies(prev => prev.filter(s => s.id !== id))
  }

  async function handleToggle(strategy: Strategy) {
    const updated = await toggleStrategy(tokenRef.current, strategy.id)
    setStrategies(prev => prev.map(s => s.id === strategy.id ? updated : s))
  }

  if (!authChecked || !meta) return null

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Strategy" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Strategy Builder</h1>
          <p className="text-xs text-zinc-400">
            Build rules-based strategies from technical indicators, then backtest them on any NSE/BSE symbol.
          </p>
        </div>

        <div className="space-y-5">
          <CreateForm
            meta={meta}
            tokenRef={tokenRef}
            onCreated={s => setStrategies(prev => [s, ...prev])}
          />

          {strategies.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">No strategies yet. Create one above.</p>
              <p className="mt-1 text-xs text-zinc-400">Example: RSI &lt; 30 AND MACD Histogram &gt; 0 → BUY</p>
            </div>
          ) : (
            strategies.map(s => (
              <StrategyCard
                key={s.id} strategy={s} meta={meta} tokenRef={tokenRef}
                onDeleted={() => handleDelete(s.id)}
                onToggled={handleToggle}
              />
            ))
          )}
        </div>
      </main>
    </div>
  )
}

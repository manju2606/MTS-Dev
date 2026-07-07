'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { WatchlistPicker } from '@/components/watchlist-picker'
import {
  searchStocks,
  getQuoteDetail,
  analyzeSymbol,
  validateTrade,
  placeTrade,
  getRiskConfig,
  getHistory,
} from '@/lib/api'
import type {
  StockSearchResult, WatchlistQuote, AIRecommendation, RiskCheckResult, RiskConfig, ChartPeriod, HistoryBar,
} from '@/lib/api'
import { PriceChart } from '@/components/price-chart'

// In-memory, tab-lifetime cache so re-selecting a symbol (e.g. flipping back
// and forth from a watchlist) renders instantly from cache while a fresh
// fetch quietly updates it in the background — no spinner on repeat visits.
const _quoteCache = new Map<string, WatchlistQuote>()
const _recCache = new Map<string, AIRecommendation>()

function fmtINR(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtVol(n: number) {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(2)} Cr`
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(2)} L`
  return n.toLocaleString('en-IN')
}

const TREND_CLS: Record<string, string> = {
  BULLISH: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  BEARISH: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
  MIXED: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
}

const SIGNAL_CLS: Record<string, string> = {
  BUY: 'bg-emerald-600 text-white',
  SELL: 'bg-red-600 text-white',
  HOLD: 'bg-zinc-400 text-white',
}

// ── Stock search ────────────────────────────────────────────────────────────

function StockSearch({ token, onSelect }: { token: string; onSelect: (r: StockSearchResult) => void }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(val: string) {
    setQuery(val)
    if (searchRef.current) clearTimeout(searchRef.current)
    if (val.trim().length < 2) { setSuggestions([]); return }
    searchRef.current = setTimeout(() => {
      searchStocks(token, val).then(setSuggestions)
    }, 250)
  }

  function handlePick(r: StockSearchResult) {
    setQuery(`${r.symbol.replace('.NS', '').replace('.BO', '')} — ${r.name}`)
    setSuggestions([])
    onSelect(r)
  }

  return (
    <div className="relative w-full max-w-md">
      <input
        value={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search a stock to trade (e.g. INFY, Reliance…)"
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {suggestions.map(r => (
            <li key={r.symbol}>
              <button type="button" onClick={() => handlePick(r)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {r.symbol.replace('.NS', '').replace('.BO', '')}
                </span>
                <span className="ml-2 truncate text-zinc-400">{r.name}</span>
                <span className="ml-2 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{r.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Indicator panel ───────────────────────────────────────────────────────────

function IndicatorStat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${cls ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-400">{sub}</p>}
    </div>
  )
}

function IndicatorPanel({ q }: { q: WatchlistQuote }) {
  const pos = q.change_pct >= 0
  const bbRange = q.bb_upper - q.bb_lower
  const bbPct = bbRange > 0 ? Math.round((q.ltp - q.bb_lower) / bbRange * 100) : null

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              {q.symbol.replace('.NS', '').replace('.BO', '')}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TREND_CLS[q.trend]}`}>{q.trend}</span>
          </div>
          <p className="text-xs text-zinc-500">{q.company_name} &middot; {q.sector} &middot; {q.exchange}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmtINR(q.ltp)}</p>
          <p className={`text-xs font-semibold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
            {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <IndicatorStat label="RSI (14)" value={q.rsi.toFixed(1)}
          cls={q.rsi >= 70 ? 'text-red-500' : q.rsi <= 30 ? 'text-emerald-600' : undefined} />
        <IndicatorStat label="MACD" value={q.macd.toFixed(2)}
          sub={`Signal ${q.macd_signal.toFixed(2)}`}
          cls={q.macd >= q.macd_signal ? 'text-emerald-600' : 'text-red-500'} />
        <IndicatorStat label="Bollinger %B" value={bbPct != null ? `${bbPct}%` : '—'}
          cls={bbPct != null && bbPct >= 80 ? 'text-red-500' : bbPct != null && bbPct <= 20 ? 'text-emerald-600' : undefined} />
        <IndicatorStat label="Volume" value={`${q.vol_ratio.toFixed(1)}x`} sub={fmtVol(q.volume)}
          cls={q.vol_ratio >= 1.5 ? 'text-amber-600' : undefined} />
        <IndicatorStat label="SMA20" value={fmtINR(q.sma20)}
          cls={q.above_sma20 ? 'text-emerald-600' : q.above_sma20 === false ? 'text-red-500' : undefined} />
        <IndicatorStat label="SMA50" value={fmtINR(q.sma50)}
          cls={q.above_sma50 ? 'text-emerald-600' : q.above_sma50 === false ? 'text-red-500' : undefined} />
        <IndicatorStat label="SMA200" value={fmtINR(q.sma200)}
          cls={q.above_sma200 ? 'text-emerald-600' : q.above_sma200 === false ? 'text-red-500' : undefined} />
        <IndicatorStat label="VWAP" value={fmtINR(q.vwap)} />
        <IndicatorStat label="Day Range" value={`${fmtINR(q.day_low)} – ${fmtINR(q.day_high)}`} />
        <IndicatorStat label="52W High" value={fmtINR(q.week52_high)} sub={`${q.pct_from_52w_high.toFixed(1)}% away`} />
        <IndicatorStat label="52W Low" value={fmtINR(q.week52_low)} sub={`+${q.pct_from_52w_low.toFixed(1)}% above`} />
        <IndicatorStat label="Market Cap" value={q.market_cap_category || '—'} />
      </div>
    </div>
  )
}

// ── AI recommendation card ─────────────────────────────────────────────────────

function pnlFromEntry(entry: number, price: number, signal: 'BUY' | 'SELL' | 'HOLD') {
  const dir = signal === 'SELL' ? -1 : 1
  const pts = (price - entry) * dir
  const pct = (pts / entry) * 100
  const sign = pts >= 0 ? '+' : ''
  return `${sign}${pts.toFixed(2)} (${sign}${pct.toFixed(1)}%)`
}

function AICard({ rec, loading }: { rec: AIRecommendation | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      </div>
    )
  }
  if (!rec) return null
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900 dark:bg-indigo-950/20">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">AI Recommendation</p>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${SIGNAL_CLS[rec.signal]}`}>{rec.signal}</span>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.round(rec.confidence * 100)}%` }} />
        </div>
        <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{Math.round(rec.confidence * 100)}%</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-white p-2 dark:bg-zinc-900">
          <p className="text-[10px] text-zinc-400">Entry</p>
          <p className="font-bold text-zinc-900 dark:text-zinc-50">{fmtINR(rec.entry_price)}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
          <p className="text-[10px] text-red-400">Stop Loss</p>
          <p className="font-bold text-red-600">{fmtINR(rec.stop_loss)}</p>
          <p className="text-[10px] text-red-400">{pnlFromEntry(rec.entry_price, rec.stop_loss, rec.signal)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target</p>
          <p className="font-bold text-emerald-600">{fmtINR(rec.target)}</p>
          <p className="text-[10px] text-emerald-500">{pnlFromEntry(rec.entry_price, rec.target, rec.signal)}</p>
        </div>
        <div className="rounded-lg bg-white p-2 dark:bg-zinc-900">
          <p className="text-[10px] text-zinc-400">R:R &middot; Hold</p>
          <p className="font-bold text-zinc-900 dark:text-zinc-50">{rec.risk_reward_ratio.toFixed(2)}x &middot; {rec.holding_period}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{rec.explanation}</p>
    </div>
  )
}

// ── Trade ticket ──────────────────────────────────────────────────────────────

function TradeTicket({
  token, symbol, ltp, rec, riskConfig,
}: {
  token: string
  symbol: string
  ltp: number
  rec: AIRecommendation | null
  riskConfig: RiskConfig | null
}) {
  const [signal, setSignal] = useState<'BUY' | 'SELL'>('BUY')
  const [quantity, setQuantity] = useState(1)
  const [stopLoss, setStopLoss] = useState(0)
  const [target, setTarget] = useState(0)
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState(ltp)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<RiskCheckResult | null>(null)
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState('')
  const [placed, setPlaced] = useState(false)
  const [placedPending, setPlacedPending] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1D')
  const [chartBars, setChartBars] = useState<HistoryBar[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => {
    if (!showChart) return
    setChartLoading(true)
    getHistory(token, symbol, chartPeriod)
      .then(setChartBars)
      .catch(() => setChartBars([]))
      .finally(() => setChartLoading(false))
  }, [showChart, token, symbol, chartPeriod])

  useEffect(() => {
    if (rec && rec.signal !== 'HOLD') {
      setSignal(rec.signal)
      setStopLoss(rec.stop_loss)
      setTarget(rec.target)
    } else {
      setStopLoss(Math.round(ltp * 0.975 * 100) / 100)
      setTarget(Math.round(ltp * 1.05 * 100) / 100)
    }
    setLimitPrice(ltp)
    setCheckResult(null)
    setPlaced(false)
    setPlacedPending(false)
    setPlaceError('')
  }, [rec, ltp])

  const entry = orderType === 'LIMIT' ? limitPrice : ltp

  async function handleCheck() {
    setChecking(true)
    setCheckResult(null)
    try {
      const result = await validateTrade(token, { signal, entry_price: entry, stop_loss: stopLoss, target, quantity })
      setCheckResult(result)
    } catch {
      setCheckResult(null)
    } finally {
      setChecking(false)
    }
  }

  async function handlePlace() {
    setPlacing(true)
    setPlaceError('')
    try {
      const trade = await placeTrade(token, {
        symbol, signal, stop_loss: stopLoss, target, quantity,
        limit_price: orderType === 'LIMIT' ? limitPrice : undefined,
      })
      setPlacedPending(trade.status === 'pending')
      setPlaced(true)
    } catch (e) {
      setPlaceError((e as Error).message)
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Paper Trade Ticket</p>

      <div className="mb-4 flex gap-2">
        {(['BUY', 'SELL'] as const).map(s => (
          <button key={s} onClick={() => { setSignal(s); setCheckResult(null); setPlaced(false) }}
            className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors ${
              signal === s
                ? s === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}>
            {s}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        {(['MARKET', 'LIMIT'] as const).map(t => (
          <button key={t} onClick={() => setOrderType(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              orderType === t
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {orderType === 'LIMIT' && (
          <label className="col-span-2 text-xs text-zinc-500">
            Limit Price
            <input type="number" value={limitPrice} onChange={e => setLimitPrice(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
          </label>
        )}
        <label className="text-xs text-zinc-500">
          Quantity
          <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
        </label>
        <label className="text-xs text-zinc-500">
          Entry
          <input disabled value={fmtINR(entry)}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>
        <label className="text-xs text-zinc-500">
          Stop Loss
          <input type="number" value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-zinc-800" />
        </label>
        <label className="text-xs text-zinc-500">
          Target
          <input type="number" value={target} onChange={e => setTarget(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-600 dark:border-emerald-900 dark:bg-zinc-800" />
        </label>
      </div>

      {riskConfig && (
        <p className="mb-3 text-[10px] text-zinc-400">
          Capital {fmtINR(riskConfig.capital)} &middot; Max position {riskConfig.max_position_pct}% &middot; Min R:R {riskConfig.min_risk_reward}x
        </p>
      )}

      {checkResult && (() => {
        const dir = signal === 'BUY' ? 1 : -1
        const slAmt = (stopLoss - entry) * dir * quantity
        const slPct = entry > 0 ? ((stopLoss - entry) / entry) * 100 * dir : 0
        const tgtAmt = (target - entry) * dir * quantity
        const tgtPct = entry > 0 ? ((target - entry) / entry) * 100 * dir : 0
        const fmtSigned = (n: number) => `${n >= 0 ? '+' : '-'}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

        return (
          <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${
            checkResult.passed
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
          }`}>
            {checkResult.passed ? 'Risk check passed.' : (
              <ul className="list-inside list-disc">
                {checkResult.violations.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            )}
            {checkResult.max_quantity != null && (
              <p className="mt-1 font-semibold">Suggested max quantity: {checkResult.max_quantity}</p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-black/5 pt-2 dark:border-white/10">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-red-500 dark:text-red-400">At Stop Loss (qty {quantity})</p>
                <p className="font-bold text-red-600 dark:text-red-400">{fmtSigned(slAmt)} <span className="font-normal">({fmtPct(slPct)})</span></p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">At Target (qty {quantity})</p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">{fmtSigned(tgtAmt)} <span className="font-normal">({fmtPct(tgtPct)})</span></p>
              </div>
            </div>
          </div>
        )
      })()}

      {placeError && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {placeError}
        </div>
      )}

      {placed && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {placedPending
            ? `Order queued — will open automatically once the price reaches ${fmtINR(entry)} during market hours.`
            : 'Paper trade placed successfully.'}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setShowChart(v => !v)}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            showChart
              ? 'bg-indigo-600 text-white'
              : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
          }`}>
          📈 {showChart ? 'Hide Chart' : 'Chart'}
        </button>
        <button onClick={handleCheck} disabled={checking}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {checking ? 'Checking…' : 'Check Risk'}
        </button>
        <button onClick={handlePlace} disabled={placing}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
            signal === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
          }`}>
          {placing ? 'Placing…' : `Place Paper ${signal}`}
        </button>
      </div>

      {showChart && (
        <div className="mt-4">
          <PriceChart
            symbol={symbol}
            data={chartBars}
            period={chartPeriod}
            onPeriodChange={setChartPeriod}
            loading={chartLoading}
            currentPrice={entry}
            aiLevels={{ signal, entry, stopLoss, target }}
          />
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TradeView() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<StockSearchResult | null>(null)
  const [quote, setQuote] = useState<WatchlistQuote | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [riskConfig, setRiskConfig] = useState<RiskConfig | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [loadingRec, setLoadingRec] = useState(false)
  const [error, setError] = useState('')
  const selectedSymbolRef = useRef<string | null>(null)

  useEffect(() => {
    setToken(localStorage.getItem('mts_token') ?? '')
  }, [])

  useEffect(() => {
    if (!token) return
    getRiskConfig(token).then(setRiskConfig).catch(() => {})
  }, [token])

  async function handleSelect(r: StockSearchResult) {
    setSelected(r)
    setError('')
    selectedSymbolRef.current = r.symbol

    const cachedQuote = _quoteCache.get(r.symbol) ?? null
    const cachedRec = _recCache.get(r.symbol) ?? null
    setQuote(cachedQuote)
    setRec(cachedRec)
    setLoadingQuote(!cachedQuote)
    setLoadingRec(!cachedRec)

    getQuoteDetail(token, r.symbol)
      .then(q => {
        _quoteCache.set(r.symbol, q)
        if (selectedSymbolRef.current === r.symbol) setQuote(q)
      })
      .catch(e => { if (!cachedQuote) setError((e as Error).message) })
      .finally(() => setLoadingQuote(false))
    analyzeSymbol(token, r.symbol)
      .then(rc => {
        _recCache.set(r.symbol, rc)
        if (selectedSymbolRef.current === r.symbol) setRec(rc)
      })
      .catch(() => {})
      .finally(() => setLoadingRec(false))
  }

  // Deep-link support: /trade?symbol=RELIANCE.NS
  useEffect(() => {
    if (!token || selected) return
    const symbolParam = searchParams.get('symbol')
    if (!symbolParam) return
    const bare = symbolParam.replace(/\.(NS|BO)$/, '')
    searchStocks(token, bare).then(results => {
      const match = results.find(r => r.symbol === symbolParam) ?? results[0]
      if (match) handleSelect(match)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, searchParams])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Quick Trade" />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Quick Trade</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Pick a stock, review the indicators and AI signal, then place a paper trade &mdash; all in one place.
          </p>
        </div>

        <div className="mb-4">
          <StockSearch token={token} onSelect={handleSelect} />
        </div>
        <div className="mb-6">
          <WatchlistPicker token={token} selectedSymbol={selected?.symbol} onSelect={handleSelect} />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {!selected ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white py-20 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 text-5xl">&#128200;</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">Search for a stock to get started</h3>
            <p className="text-sm text-zinc-500">Indicators, AI signal, and a ready-to-place paper trade ticket will appear here.</p>
          </div>
        ) : loadingQuote || !quote ? (
          <div className="space-y-4">
            <div className="h-56 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-40 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ) : quote.error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Couldn&apos;t load market data for {quote.symbol.replace('.NS', '').replace('.BO', '')} ({quote.error}).
              This is usually a transient data-provider hiccup.
            </p>
            <button
              onClick={() => selected && handleSelect(selected)}
              className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <IndicatorPanel q={quote} />
            <AICard rec={rec} loading={loadingRec} />
            <TradeTicket token={token} symbol={quote.symbol} ltp={quote.ltp} rec={rec} riskConfig={riskConfig} />
          </div>
        )}
      </div>
    </div>
  )
}

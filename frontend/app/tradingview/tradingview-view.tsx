'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import { WatchlistPicker } from '@/components/watchlist-picker'
import {
  searchStocks,
  getHistory,
  getQuoteDetail,
  analyzeSymbol,
} from '@/lib/api'
import type {
  StockSearchResult, HistoryBar, ChartPeriod, WatchlistQuote, AIRecommendation,
} from '@/lib/api'

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
        placeholder="Search a stock (e.g. INFY, Reliance…)"
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

// ── Indicator strip (all the important indicators, compact) ───────────────────

function IndicatorStat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${cls ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-400">{sub}</p>}
    </div>
  )
}

function IndicatorGrid({ q }: { q: WatchlistQuote }) {
  const bbRange = q.bb_upper - q.bb_lower
  const bbPct = bbRange > 0 ? Math.round((q.ltp - q.bb_lower) / bbRange * 100) : null

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <IndicatorStat label="RSI (14)" value={q.rsi.toFixed(1)}
        cls={q.rsi >= 70 ? 'text-red-500' : q.rsi <= 30 ? 'text-emerald-600' : undefined} />
      <IndicatorStat label="MACD" value={q.macd.toFixed(2)} sub={`Signal ${q.macd_signal.toFixed(2)}`}
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
  )
}

function AIStrip({ rec }: { rec: AIRecommendation | null }) {
  if (!rec) return null
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${SIGNAL_CLS[rec.signal]}`}>{rec.signal}</span>
      <span className="text-xs text-zinc-500">Confidence <b className="text-indigo-700 dark:text-indigo-300">{Math.round(rec.confidence * 100)}%</b></span>
      <span className="text-xs text-zinc-500">Entry <b>{fmtINR(rec.entry_price)}</b></span>
      <span className="text-xs text-red-500">SL <b>{fmtINR(rec.stop_loss)}</b></span>
      <span className="text-xs text-emerald-600">Target <b>{fmtINR(rec.target)}</b></span>
      <span className="text-xs text-zinc-500">R:R <b>{rec.risk_reward_ratio.toFixed(2)}x</b> &middot; {rec.holding_period}</span>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TradingViewPageView() {
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<StockSearchResult | null>(null)
  const [bars, setBars] = useState<HistoryBar[]>([])
  const [period, setPeriod] = useState<ChartPeriod>('1D')
  const [chartLoading, setChartLoading] = useState(false)
  const [quote, setQuote] = useState<WatchlistQuote | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setToken(localStorage.getItem('mts_token') ?? '')
  }, [])

  function loadChart(symbol: string, p: ChartPeriod) {
    setChartLoading(true)
    getHistory(token, symbol, p)
      .then(setBars)
      .catch(() => setBars([]))
      .finally(() => setChartLoading(false))
  }

  function handleSelect(r: StockSearchResult) {
    setSelected(r)
    setError('')
    setQuote(null)
    setRec(null)
    loadChart(r.symbol, period)
    getQuoteDetail(token, r.symbol).then(setQuote).catch(e => setError((e as Error).message))
    analyzeSymbol(token, r.symbol).then(setRec).catch(() => {})
  }

  function handlePeriodChange(p: ChartPeriod) {
    setPeriod(p)
    if (selected) loadChart(selected.symbol, p)
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="TradingView" />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">TradingView</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Candlestick chart with volume, all the key indicators, and the AI signal for any stock &mdash; in one terminal.
            </p>
          </div>
          {selected && (
            <Link href={`/trade?symbol=${encodeURIComponent(selected.symbol)}`}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              Trade this stock →
            </Link>
          )}
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
            <div className="mb-4 text-5xl">&#128201;</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">Search for a stock to open the chart</h3>
            <p className="text-sm text-zinc-500">Candles, volume, RSI, MACD, SMAs, Bollinger Bands, and the AI signal will appear here.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {selected.symbol.replace('.NS', '').replace('.BO', '')}
              </h2>
              {quote && !quote.error && (
                <>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TREND_CLS[quote.trend]}`}>{quote.trend}</span>
                  <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{fmtINR(quote.ltp)}</span>
                  <span className={`text-sm font-semibold ${quote.change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
                  </span>
                  <span className="text-xs text-zinc-400">{quote.company_name} &middot; {quote.sector}</span>
                </>
              )}
            </div>

            <PriceChart
              symbol={selected.symbol}
              data={bars}
              period={period}
              onPeriodChange={handlePeriodChange}
              loading={chartLoading}
              aiLevels={rec ? { signal: rec.signal, entry: rec.entry_price, stopLoss: rec.stop_loss, target: rec.target } : null}
            />

            <AIStrip rec={rec} />

            {quote && quote.error ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                Indicators unavailable right now ({quote.error}).
              </div>
            ) : quote ? (
              <IndicatorGrid q={quote} />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

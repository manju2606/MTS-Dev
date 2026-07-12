'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import {
  getUsaStockQuotes, getUsaStockOhlc, getUsaStockPredict, getUsaStockRanked, addUsaStock, removeUsaStock,
} from '@/lib/api'
import type {
  UsaStockQuote, UsaStockCode, UsaStockOhlcPeriod, UsaStockRankedPeriod, UsaStockRankedRow, HistoryBar, ChartPeriod,
} from '@/lib/api'
import type { PredictionPoint } from '@/components/price-chart'
import { USA_STOCK_DIRECTORY } from '@/lib/usa-stock-directory'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const QUOTES_CACHE_KEY = 'usa-stocks:quotes'
const RANKED_CACHE_KEY = 'usa-stocks:ranked'
const QUOTES_POLL_MS = 30_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Same rank-tiered palette as Crypto/My Trading Dashboard (matching
// AI_Commodity_Trading_Dashboard_Pro_v3.html): best performer emerald,
// worst dark red. No AI score for USA Stocks yet, so rank is by day % change.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f', '#b45309', '#991b1b']
function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

// yfinance's native intervals -- no 4h/8h (unlike Binance for crypto),
// see usa_stocks_service.PERIODS.
const CHART_PERIODS: UsaStockOhlcPeriod[] = ['1m', '5m', '15m', '30m', '1h', '1D', '1W', '1M']
const RANKED_PERIODS: UsaStockRankedPeriod[] = ['15m', '1h', '1D']

// PriceChart's built-in defaults assume MCX's Kite-resampled candles
// ('30m' derived from 15-min bars, '1D'/'1W'/'1M' all daily-resampled) --
// yfinance gives genuine 30-min/weekly/monthly candles instead, same
// override crypto-view.tsx needs for Binance's real candles.
const USA_STOCK_BUCKET_SECONDS: Partial<Record<ChartPeriod, number>> = {
  '30m': 1800, '1W': 604800, '1M': 2592000,
}
const USA_STOCK_VISIBLE_BARS: Partial<Record<ChartPeriod, number>> = {
  '1m': 60, '5m': 60, '15m': 60, '30m': 48, '1h': 48, '1D': 30, '1W': 20, '1M': 12,
}

function fmtUsd(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function HeatTile({
  quote, rank, selected, onClick, onRemove,
}: { quote: UsaStockQuote; rank: number; selected: boolean; onClick: () => void; onRemove: (code: string) => void }) {
  const pct = quote.change_pct
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-start rounded-2xl p-4 text-left font-bold shadow-[0_8px_20px_rgba(0,0,0,0.25)] transition-transform ${
        selected ? 'scale-[1.03] ring-2 ring-white/70' : 'hover:scale-[1.02]'
      }`}
      style={{ background: tileColor(rank), color: '#eef2ff' }}
    >
      {quote.is_custom && (
        <span
          role="button"
          tabIndex={0}
          onClick={e => { e.stopPropagation(); onRemove(quote.code) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(quote.code) } }}
          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/30 text-[10px] leading-none opacity-70 hover:opacity-100"
          title="Remove from tracked stocks"
        >
          ×
        </span>
      )}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-base">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</span>
        <span className="text-sm font-extrabold">{quote.code}</span>
      </div>
      <p className="mt-2 text-lg font-extrabold">${fmtUsd(quote.price)}</p>
      <p className="text-xs">
        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'} &middot; Day
      </p>
    </button>
  )
}

// Magnitude highlight (independent of sign): >3-5% yellow, >5-10% light
// blue, >10% light green -- same bands as My Trading Dashboard/Crypto's
// predicted-price cells.
function magnitudeHighlight(pct: number): string | null {
  const abs = Math.abs(pct)
  if (abs > 10) return '#4ade80'
  if (abs > 5) return '#38bdf8'
  if (abs > 3) return '#facc15'
  return null
}

function PredictedCell({ predicted, price }: { predicted: number | null; price: number | null }) {
  if (predicted === null) return <span className="text-zinc-400">—</span>
  const pct = price ? ((predicted - price) / price) * 100 : null
  const highlight = pct !== null ? magnitudeHighlight(pct) : null
  return (
    <span
      className="rounded px-1.5 py-0.5 font-semibold"
      style={{ color: highlight ? '#0b1220' : undefined, background: highlight ?? undefined }}
    >
      ${fmtUsd(predicted)}
      {pct !== null && (
        <span className={highlight ? '' : pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
          {' '}({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
        </span>
      )}
    </span>
  )
}

type RankedSortKey = 'code' | 'price' | 'change_pct'
const RANKED_SORT_COLUMNS: { key: RankedSortKey; label: string }[] = [
  { key: 'code', label: 'Stock' },
  { key: 'price', label: 'LTP ($)' },
  { key: 'change_pct', label: 'Chg%' },
]

function RankedPredictionTable({
  rows, sortKey, sortDir, onToggleSort,
}: {
  rows: UsaStockRankedRow[]
  sortKey: RankedSortKey | null
  sortDir: 'asc' | 'desc'
  onToggleSort: (key: RankedSortKey) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-zinc-400">Rank</th>
            {RANKED_SORT_COLUMNS.map(({ key, label }) => (
              <th
                key={key}
                onClick={() => onToggleSort(key)}
                className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {label}
                <span className="ml-1 inline-block w-2.5 text-[9px]" style={{ opacity: sortKey === key ? 1 : 0.35 }}>
                  {sortKey === key && sortDir === 'asc' ? '▲' : '▼'}
                </span>
              </th>
            ))}
            {['15m', '1H', '1D'].map(h => (
              <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.code} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
              <td className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-200">
                {RANK_MEDALS[i] ?? i + 1}
              </td>
              <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-100">{row.code}</td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">${fmtUsd(row.price)}</td>
              <td className="px-3 py-2">
                {row.change_pct !== null ? (
                  <span className={row.change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
                    {row.change_pct >= 0 ? '+' : ''}{row.change_pct.toFixed(2)}%
                  </span>
                ) : '—'}
              </td>
              {RANKED_PERIODS.map(p => (
                <td key={p} className="whitespace-nowrap px-3 py-2">
                  <PredictedCell predicted={row.predicted[p]} price={row.price} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UsaStocksView() {
  const [quotes, setQuotes] = useState<UsaStockQuote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedStock, setSelectedStock] = useState<UsaStockCode>('AAPL')
  const [chartPeriod, setChartPeriod] = useState<UsaStockOhlcPeriod>('30m')
  const [ohlc, setOhlc] = useState<HistoryBar[]>([])
  const [prediction, setPrediction] = useState<PredictionPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [ranked, setRanked] = useState<UsaStockRankedRow[] | null>(null)
  const [addCode, setAddCode] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [rankSortKey, setRankSortKey] = useState<RankedSortKey | null>(null)
  const [rankSortDir, setRankSortDir] = useState<'asc' | 'desc'>('desc')
  const tokenRef = useRef('')

  const toggleRankSort = useCallback((key: RankedSortKey) => {
    if (key === rankSortKey) {
      setRankSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setRankSortKey(key)
      setRankSortDir('desc')
    }
  }, [rankSortKey])

  const loadQuotes = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getUsaStockQuotes(token)
      setQuotes(res)
      writePageCache(QUOTES_CACHE_KEY, res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load USA stock quotes')
    }
  }, [])

  const loadRanked = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getUsaStockRanked(token)
      setRanked(res.ranked)
      writePageCache(RANKED_CACHE_KEY, res.ranked)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load ranked predictions')
      setRanked(prev => prev ?? [])
    }
  }, [])

  const loadChart = useCallback(async (code: UsaStockCode, period: UsaStockOhlcPeriod) => {
    const token = tokenRef.current
    if (!token) return
    setChartLoading(true)
    try {
      const [bars, pred] = await Promise.all([
        getUsaStockOhlc(token, code, period),
        getUsaStockPredict(token, code, period),
      ])
      setOhlc(bars)
      setPrediction(
        pred.predicted.map(p => ({ time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower })),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load chart')
    } finally {
      setChartLoading(false)
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    // Show the last-known quotes/ranked table instantly (from a previous
    // visit) instead of a blank spinner, then loadQuotes/loadRanked below
    // fetch fresh data in the background and overwrite both state and
    // the cache. Deferred a microtask so the setState calls aren't
    // synchronous within the effect body (react-hooks/set-state-in-effect).
    const cachedQuotes = readPageCache<UsaStockQuote[]>(QUOTES_CACHE_KEY)
    const cachedRanked = readPageCache<UsaStockRankedRow[]>(RANKED_CACHE_KEY)
    if (cachedQuotes || cachedRanked) {
      Promise.resolve().then(() => {
        if (cachedQuotes) setQuotes(cachedQuotes)
        if (cachedRanked) setRanked(cachedRanked)
      })
    }
    loadQuotes().catch(() => {})
    loadRanked().catch(() => {})
    const id = setInterval(() => {
      loadQuotes().catch(() => {})
      loadRanked().catch(() => {})
    }, QUOTES_POLL_MS)
    return () => clearInterval(id)
  }, [loadQuotes, loadRanked])

  useEffect(() => {
    loadChart(selectedStock, chartPeriod).catch(() => {})
  }, [selectedStock, chartPeriod, loadChart])

  const handleAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const token = tokenRef.current
    const code = addCode.trim().toUpperCase()
    if (!token || !code) return
    setAddBusy(true)
    setAddErr(null)
    setShowSuggestions(false)
    try {
      await addUsaStock(token, code)
      setAddCode('')
      setSelectedStock(code)
      await Promise.all([loadQuotes(), loadRanked()])
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Failed to add stock')
    } finally {
      setAddBusy(false)
    }
  }, [addCode, loadQuotes, loadRanked])

  const handleRemove = useCallback(async (code: string) => {
    const token = tokenRef.current
    if (!token) return
    try {
      await removeUsaStock(token, code)
      if (selectedStock === code) setSelectedStock('AAPL')
      await Promise.all([loadQuotes(), loadRanked()])
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Failed to remove stock')
    }
  }, [selectedStock, loadQuotes, loadRanked])

  const selectedQuote = quotes?.find(q => q.code === selectedStock) ?? null

  // Heat map ranked by day % change (best performer first) -- same
  // rank-tiered coloring as Crypto/My Trading Dashboard, no AI score yet.
  const heatRanked = useMemo(
    () => [...(quotes ?? [])].sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity)),
    [quotes],
  )

  const suggestions = useMemo(() => {
    const q = addCode.trim().toUpperCase()
    if (!q) return []
    return USA_STOCK_DIRECTORY
      .filter(s => s.code.startsWith(q) || s.name.toUpperCase().includes(q))
      .slice(0, 8)
  }, [addCode])

  const sortedRanked = useMemo(() => {
    const rows = ranked ?? []
    if (!rankSortKey) return rows
    // Sort directly according to rankSortDir rather than sorting ascending
    // and reversing -- reversing after a stable sort also flips the
    // tie-break order, which would visibly scramble rank order whenever
    // rows share the same value on the sorted column.
    const dir = rankSortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (rankSortKey === 'code') return dir * a.code.localeCompare(b.code)
      const av = a[rankSortKey] ?? -Infinity
      const bv = b[rankSortKey] ?? -Infinity
      return dir * (av - bv)
    })
  }, [ranked, rankSortKey, rankSortDir])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="USA Stocks" />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">🇺🇸 USA Stocks</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Live prices via yfinance (USD) for the top 50 US stocks &middot; quotes refresh every {QUOTES_POLL_MS / 1000}s.
            Chart candles are real yfinance timeframes (1m-1M). Prediction is the same local heuristic MCX/Crypto use
            (EMA slope + ROC momentum + ATR cone), not a trained model &mdash; still no paper trading yet.
          </p>
        </div>

        <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              value={addCode}
              onChange={e => { setAddCode(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Add ticker or company name, e.g. UBER"
              className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute left-0 top-full z-10 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {suggestions.map(s => (
                  <li key={s.code}>
                    <button
                      type="button"
                      onMouseDown={() => { setAddCode(s.code); setShowSuggestions(false) }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="font-semibold text-zinc-800 dark:text-zinc-100">{s.code}</span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="submit"
            disabled={addBusy || !addCode.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {addBusy ? 'Adding…' : '+ Add Stock'}
          </button>
          {addErr && <span className="text-xs text-red-500 dark:text-red-400">{addErr}</span>}
        </form>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {err}
          </div>
        )}

        {quotes === null && !err ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : (
          <>
            <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              🔥 Day Performance Heat Map
            </h2>
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {heatRanked.map((q, i) => (
                <HeatTile key={q.code} quote={q} rank={i} selected={q.code === selectedStock} onClick={() => setSelectedStock(q.code)} onRemove={handleRemove} />
              ))}
            </div>

            <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              📊 Ranked USA Stocks Prediction
            </h2>
            {ranked === null ? (
              <div className="mb-8 flex justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
            ) : (
              <div className="mb-8">
                <RankedPredictionTable
                  rows={sortedRanked}
                  sortKey={rankSortKey}
                  sortDir={rankSortDir}
                  onToggleSort={toggleRankSort}
                />
                <p className="mt-2 text-xs text-zinc-400">
                  Predicted prices are kept warm by a background job during NYSE/NASDAQ hours (same pattern
                  Crypto/MCX use) so this loads fast &mdash; a dash (—) means that stock/period hasn&apos;t been
                  refreshed yet or the market is closed.
                </p>
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {selectedQuote?.code ?? selectedStock} Price Chart
                </h2>
                {selectedQuote && (
                  <p className="mt-0.5 text-xs text-zinc-400">
                    ${fmtUsd(selectedQuote.price)} &middot; Day High ${fmtUsd(selectedQuote.day_high)}
                    {' '}&middot; Day Low ${fmtUsd(selectedQuote.day_low)} &middot; Prev Close ${fmtUsd(selectedQuote.prev_close)}
                  </p>
                )}
              </div>
            </div>

            <PriceChart
              symbol={selectedStock}
              data={ohlc}
              period={chartPeriod}
              onPeriodChange={p => setChartPeriod(p as UsaStockOhlcPeriod)}
              periods={CHART_PERIODS}
              periodBucketSeconds={USA_STOCK_BUCKET_SECONDS}
              defaultVisibleBars={USA_STOCK_VISIBLE_BARS}
              loading={chartLoading}
              currentPrice={selectedQuote?.price ?? null}
              exchangeLabel="NASDAQ/NYSE"
              currencySymbol="$"
              prediction={prediction}
            />
          </>
        )}
      </div>
    </div>
  )
}

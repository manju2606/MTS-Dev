'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import {
  getUsaStockQuotes, getUsaStockOhlc, getUsaStockPredict, getUsaStockRanked,
} from '@/lib/api'
import type {
  UsaStockQuote, UsaStockCode, UsaStockOhlcPeriod, UsaStockRankedPeriod, UsaStockRankedRow, HistoryBar, ChartPeriod,
} from '@/lib/api'
import type { PredictionPoint } from '@/components/price-chart'

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
  quote, rank, selected, onClick,
}: { quote: UsaStockQuote; rank: number; selected: boolean; onClick: () => void }) {
  const pct = quote.change_pct
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start rounded-2xl p-4 text-left font-bold shadow-[0_8px_20px_rgba(0,0,0,0.25)] transition-transform ${
        selected ? 'scale-[1.03] ring-2 ring-white/70' : 'hover:scale-[1.02]'
      }`}
      style={{ background: tileColor(rank), color: '#eef2ff' }}
    >
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

function RankedPredictionTable({ rows }: { rows: UsaStockRankedRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Rank', 'Stock', 'LTP ($)', 'Chg%', '15m', '1H', '1D'].map(h => (
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
  const tokenRef = useRef('')

  const loadQuotes = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      setQuotes(await getUsaStockQuotes(token))
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

  const selectedQuote = quotes?.find(q => q.code === selectedStock) ?? null

  // Heat map ranked by day % change (best performer first) -- same
  // rank-tiered coloring as Crypto/My Trading Dashboard, no AI score yet.
  const heatRanked = useMemo(
    () => [...(quotes ?? [])].sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity)),
    [quotes],
  )

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
                <HeatTile key={q.code} quote={q} rank={i} selected={q.code === selectedStock} onClick={() => setSelectedStock(q.code)} />
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
                <RankedPredictionTable rows={ranked} />
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

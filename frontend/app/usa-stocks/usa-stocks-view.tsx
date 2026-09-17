'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import {
  getUsaStockQuotes, getUsaStockOhlc, getUsaStockPredict, getUsaStockRanked, getUsaStockTopPicks,
  getUsaStockMovers, addUsaStock, removeUsaStock,
} from '@/lib/api'
import type {
  UsaStockQuote, UsaStockCode, UsaStockOhlcPeriod, UsaStockRankedPeriod, UsaStockRankedRow, UsaStockPrediction,
  UsaStockTopPick, UsaStockTopPicksResponse, UsaMoverPeriod, UsaStockMoverEntry, UsaStockMomentumEntry,
  UsaStockMoversResponse, HistoryBar, ChartPeriod,
} from '@/lib/api'
import type { PredictionPoint } from '@/components/price-chart'
import { USA_STOCK_DIRECTORY } from '@/lib/usa-stock-directory'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const QUOTES_CACHE_KEY = 'usa-stocks:quotes'
const RANKED_CACHE_KEY = 'usa-stocks:ranked'
const TOP_PICKS_CACHE_KEY = 'usa-stocks:top-picks'
const MOVERS_CACHE_KEY = 'usa-stocks:movers'
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

// ── Ticker search/add: typeahead over the local directory, but submitting
// (Enter or the button) always works for ANY ticker -- even one absent from
// the directory (e.g. HOOD) -- since it's passed straight to onAdd, which
// hits POST /usa-stocks/custom and lets the backend validate it via yfinance.
function TickerAddSearch({
  onAdd, placeholder,
}: { onAdd: (code: string) => Promise<void>; placeholder: string }) {
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return []
    return USA_STOCK_DIRECTORY
      .filter(s => s.code.startsWith(q) || s.name.toUpperCase().includes(q))
      .slice(0, 8)
  }, [query])

  async function submit(code: string) {
    const c = code.trim().toUpperCase()
    if (!c || busy) return
    setBusy(true)
    setErr(null)
    setShowSuggestions(false)
    try {
      await onAdd(c)
      setQuery('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add stock')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={e => { e.preventDefault(); submit(query) }} className="flex items-center gap-2">
        <div className="relative">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={placeholder}
            className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute left-0 top-full z-10 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {suggestions.map(s => (
                <li key={s.code}>
                  <button
                    type="button"
                    onMouseDown={() => submit(s.code)}
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
          disabled={busy || !query.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Searching…' : '🔍 Search'}
        </button>
      </form>
      {err && <span className="text-xs text-red-500 dark:text-red-400">{err}</span>}
    </div>
  )
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

// ── Analyse Stock tab: LTP + day/week/month prediction for one stock ────────
// Reuses the same /usa-stocks/predict endpoint the Overview chart/ranked
// table already call, just at the '1D'/'1W'/'1M' OHLC periods -- predicted[0]
// at each of those periods is literally "next day's close" / "next week's
// close" / "next month's close" (see usa_stocks_prediction_service.get_prediction),
// so no new backend endpoint is needed for a day/week/month forecast.

type UsaHorizon = '1D' | '1W' | '1M'
const HORIZONS: { key: UsaHorizon; label: string }[] = [
  { key: '1D', label: 'Day' },
  { key: '1W', label: 'Week' },
  { key: '1M', label: 'Month' },
]

function HorizonPredictionCard({
  label, prediction, price,
}: { label: string; prediction: UsaStockPrediction | null; price: number | null }) {
  const next = prediction?.predicted[0] ?? null
  const pct = next && price ? ((next.predicted_close - price) / price) * 100 : null
  const color = pct === null ? 'text-zinc-500 dark:text-zinc-400' : pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label} ahead</p>
      {next ? (
        <>
          <p className={`text-lg font-bold ${color}`}>${fmtUsd(next.predicted_close)}</p>
          <p className={`text-xs font-semibold ${color}`}>
            {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">Range ${fmtUsd(next.lower)} – ${fmtUsd(next.upper)}</p>
        </>
      ) : (
        <p className="text-xs text-zinc-400">{prediction?.note ?? 'Loading…'}</p>
      )}
    </div>
  )
}

function AnalyseStockTab({
  quotes, selectedStock, onSelectStock, onAddStock,
}: {
  quotes: UsaStockQuote[] | null
  selectedStock: UsaStockCode
  onSelectStock: (code: UsaStockCode) => void
  onAddStock: (code: string) => Promise<void>
}) {
  const [horizon, setHorizon] = useState<UsaHorizon>('1D')
  const [predictions, setPredictions] = useState<Partial<Record<UsaHorizon, UsaStockPrediction>>>({})
  const [ohlc, setOhlc] = useState<HistoryBar[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
  }, [])

  const loadPredictions = useCallback(async (code: UsaStockCode) => {
    const token = tokenRef.current
    if (!token || !code) return
    setPredictions({})
    try {
      const results = await Promise.all(HORIZONS.map(h => getUsaStockPredict(token, code, h.key)))
      setPredictions(Object.fromEntries(HORIZONS.map((h, i) => [h.key, results[i]])) as Record<UsaHorizon, UsaStockPrediction>)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load predictions')
    }
  }, [])

  const loadHorizonChart = useCallback(async (code: UsaStockCode, period: UsaHorizon) => {
    const token = tokenRef.current
    if (!token || !code) return
    setChartLoading(true)
    try {
      setOhlc(await getUsaStockOhlc(token, code, period))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load chart')
    } finally {
      setChartLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPredictions(selectedStock).catch(() => {})
  }, [selectedStock, loadPredictions])

  useEffect(() => {
    loadHorizonChart(selectedStock, horizon).catch(() => {})
  }, [selectedStock, horizon, loadHorizonChart])

  const quote = quotes?.find(q => q.code === selectedStock) ?? null
  const activePrediction = predictions[horizon] ?? null
  const predictionPoints: PredictionPoint[] = (activePrediction?.predicted ?? []).map(p => ({
    time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower,
  }))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400" htmlFor="analyse-stock-picker">
          Analyse:
        </label>
        <select
          id="analyse-stock-picker"
          value={selectedStock}
          onChange={e => onSelectStock(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {(quotes ?? []).map(q => <option key={q.code} value={q.code}>{q.code}</option>)}
        </select>
        <span className="text-xs text-zinc-400">or</span>
        <TickerAddSearch onAdd={onAddStock} placeholder="Type any US ticker, e.g. HOOD" />
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {err}
        </div>
      )}

      {quote && (
        <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{quote.code}</span>
            <span className={`text-sm font-semibold ${quote.change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              ${fmtUsd(quote.price)} ({quote.change_pct >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
              <p className="text-[10px] text-zinc-400">LTP</p>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">${fmtUsd(quote.price)}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
              <p className="text-[10px] text-zinc-400">Day High / Low</p>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">${fmtUsd(quote.day_high)} / ${fmtUsd(quote.day_low)}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
              <p className="text-[10px] text-zinc-400">Prev Close</p>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">${fmtUsd(quote.prev_close)}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
              <p className="text-[10px] text-zinc-400">Volume</p>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{quote.volume.toLocaleString('en-US')}</p>
            </div>
          </div>
        </div>
      )}

      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Predictions &middot; {activePrediction?.method ?? 'ema20-slope + roc-momentum + atr-cone (local heuristic, not a trained model)'}
      </p>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {HORIZONS.map(h => (
          <HorizonPredictionCard key={h.key} label={h.label} prediction={predictions[h.key] ?? null} price={quote?.price ?? null} />
        ))}
      </div>

      <PriceChart
        symbol={selectedStock}
        data={ohlc}
        period={horizon}
        onPeriodChange={p => setHorizon(p as UsaHorizon)}
        periods={['1D', '1W', '1M']}
        periodBucketSeconds={USA_STOCK_BUCKET_SECONDS}
        defaultVisibleBars={USA_STOCK_VISIBLE_BARS}
        loading={chartLoading}
        currentPrice={quote?.price ?? null}
        exchangeLabel="NASDAQ/NYSE"
        currencySymbol="$"
        prediction={predictionPoints}
      />

      {activePrediction?.note && (
        <p className="mt-2 text-xs text-zinc-400">{activePrediction.note}</p>
      )}
    </>
  )
}

// ── Top Picks: "5 best stocks to trade today" ────────────────────────────────
const TOP_PICKS_POLL_MS = 60_000
const SIGNAL_STYLES: Record<UsaStockTopPick['signal'], string> = {
  BUY: 'bg-emerald-600 text-white',
  SELL: 'bg-red-600 text-white',
  HOLD: 'bg-zinc-400 text-white',
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 60 ? '#10b981' : score <= 40 ? '#ef4444' : '#a1a1aa'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{score}</span>
    </div>
  )
}

function TopPickCard({ pick, rank, onAnalyse }: { pick: UsaStockTopPick; rank: number; onAnalyse: (code: UsaStockCode) => void }) {
  const day = pick.day
  const week = pick.week
  return (
    <button
      onClick={() => onAnalyse(pick.code)}
      className="flex flex-col items-start rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-transform hover:scale-[1.02] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-2 flex w-full items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400">#{rank + 1}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLES[pick.signal]}`}>{pick.signal}</span>
      </div>
      <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{pick.code}</span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400">${fmtUsd(pick.price)}</span>
      <div className="mt-2 w-full">
        <ScoreBar score={pick.ai_score} />
      </div>
      <div className="mt-3 grid w-full grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[10px] text-zinc-400">Day</p>
          <p className={day.change_pct >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-500 dark:text-red-400'}>
            ${fmtUsd(day.predicted_close)} ({day.change_pct >= 0 ? '+' : ''}{day.change_pct.toFixed(2)}%)
          </p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Week</p>
          {week.predicted_close !== null && week.change_pct !== null ? (
            <p className={week.change_pct >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-500 dark:text-red-400'}>
              ${fmtUsd(week.predicted_close)} ({week.change_pct >= 0 ? '+' : ''}{week.change_pct.toFixed(2)}%)
            </p>
          ) : <p className="text-zinc-400">—</p>}
        </div>
      </div>
    </button>
  )
}

function TopPicksTab({ onAnalyse }: { onAnalyse: (code: UsaStockCode) => void }) {
  const [picks, setPicks] = useState<UsaStockTopPick[] | null>(null)
  const [method, setMethod] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getUsaStockTopPicks(token, 5)
      setPicks(res.picks)
      setMethod(res.method)
      setErr(null)
      writePageCache(TOP_PICKS_CACHE_KEY, res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load top picks')
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    // Show the last-known picks instantly (from a previous visit) instead
    // of a blank spinner, then load() below fetches fresh data in the
    // background and overwrites both state and the cache -- same pattern
    // as the Overview tab's quotes/ranked cache.
    const cached = readPageCache<UsaStockTopPicksResponse>(TOP_PICKS_CACHE_KEY)
    if (cached) {
      Promise.resolve().then(() => {
        setPicks(cached.picks)
        setMethod(cached.method)
      })
    }
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, TOP_PICKS_POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Today&apos;s 5 highest-conviction calls among tracked USA stocks, ranked by AI score (0-100, 50=neutral)
        &mdash; the same local heuristic prediction Analyse Stock uses, just turned into a sortable score and a
        BUY/SELL/HOLD call. Not a trained model or formal recommendation &mdash; no entry/stop/target here, click
        a card to open it in Analyse Stock.
      </p>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {err}
        </div>
      )}

      {picks === null && !err ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(picks ?? []).map((p, i) => (
            <TopPickCard key={p.code} pick={p} rank={i} onAnalyse={onAnalyse} />
          ))}
          {picks && picks.length === 0 && (
            <p className="col-span-full text-sm text-zinc-400">No picks available yet.</p>
          )}
        </div>
      )}

      {method && <p className="mt-4 text-xs text-zinc-400">{method}</p>}

      <MoversSection onAnalyse={onAnalyse} />
    </>
  )
}

// ── Movers: Top Gainers/Losers/Most Active (Day/Week/Month) + Momentum ──────
function fmtVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString('en-US')
}

function MoverRow({ rank, code, price, right, onAnalyse }: {
  rank: number; code: UsaStockCode; price: number; right: React.ReactNode; onAnalyse: (code: UsaStockCode) => void
}) {
  return (
    <li>
      <button
        onClick={() => onAnalyse(code)}
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400">{rank + 1}</span>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{code}</span>
        </span>
        <span className="text-right text-xs">
          <span className="block text-zinc-500 dark:text-zinc-400">${fmtUsd(price)}</span>
          {right}
        </span>
      </button>
    </li>
  )
}

function MoverList({
  title, icon, rows, metric, onAnalyse,
}: {
  title: string
  icon: string
  rows: UsaStockMoverEntry[]
  metric: 'change_pct' | 'volume'
  onAnalyse: (code: UsaStockCode) => void
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{icon} {title}</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400">No data</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r, i) => (
            <MoverRow
              key={r.code}
              rank={i}
              code={r.code}
              price={r.price}
              onAnalyse={onAnalyse}
              right={metric === 'change_pct' ? (
                <span className={r.change_pct !== null && r.change_pct >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-500 dark:text-red-400'}>
                  {r.change_pct !== null ? `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%` : '—'}
                </span>
              ) : (
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{fmtVolume(r.volume)}</span>
              )}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function MomentumList({ rows, onAnalyse }: { rows: UsaStockMomentumEntry[]; onAnalyse: (code: UsaStockCode) => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">⚡ Momentum (RSI-14)</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400">No data</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r, i) => (
            <MoverRow
              key={r.code}
              rank={i}
              code={r.code}
              price={r.price}
              onAnalyse={onAnalyse}
              right={
                <span className={r.bias === 'Bullish' ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-500 dark:text-red-400'}>
                  RSI {r.rsi} &middot; {r.bias}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const MOVER_PERIODS: { key: UsaMoverPeriod; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]
const MOVERS_POLL_MS = 60_000

function MoversSection({ onAnalyse }: { onAnalyse: (code: UsaStockCode) => void }) {
  const [period, setPeriod] = useState<UsaMoverPeriod>('day')
  const [movers, setMovers] = useState<UsaStockMoversResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getUsaStockMovers(token, 5)
      setMovers(res)
      setErr(null)
      writePageCache(MOVERS_CACHE_KEY, res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load movers')
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    // Show the last-known movers instantly (from a previous visit) instead
    // of a blank spinner, then load() below fetches fresh data in the
    // background and overwrites both state and the cache.
    const cached = readPageCache<UsaStockMoversResponse>(MOVERS_CACHE_KEY)
    if (cached) {
      Promise.resolve().then(() => setMovers(cached))
    }
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, MOVERS_POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const block = movers?.[period] ?? null

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">📈 Movers</h2>
        <div className="flex items-center gap-1">
          {MOVER_PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors"
              style={period === p.key
                ? { background: '#4f46e5', color: '#fff' }
                : { background: '#e4e4e7', color: '#52525b' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {err}
        </div>
      )}

      {movers === null && !err ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoverList title="Top Gainers" icon="🚀" rows={block?.gainers ?? []} metric="change_pct" onAnalyse={onAnalyse} />
          <MoverList title="Top Losers" icon="🔻" rows={block?.losers ?? []} metric="change_pct" onAnalyse={onAnalyse} />
          <MoverList title="Most Active" icon="🔥" rows={block?.most_active ?? []} metric="volume" onAnalyse={onAnalyse} />
          <MomentumList rows={movers?.momentum ?? []} onAnalyse={onAnalyse} />
        </div>
      )}

      {movers?.method && <p className="mt-3 text-xs text-zinc-400">{movers.method}</p>}
    </div>
  )
}

type MainTab = 'overview' | 'analyse' | 'top-picks'
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'analyse', label: '🔍 Analyse Stock' },
  { id: 'top-picks', label: '🏆 Top Picks & Movers' },
]

export default function UsaStocksView() {
  const [tab, setTab] = useState<MainTab>('overview')
  const [quotes, setQuotes] = useState<UsaStockQuote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedStock, setSelectedStock] = useState<UsaStockCode>('AAPL')
  const [chartPeriod, setChartPeriod] = useState<UsaStockOhlcPeriod>('30m')
  const [ohlc, setOhlc] = useState<HistoryBar[]>([])
  const [prediction, setPrediction] = useState<PredictionPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [ranked, setRanked] = useState<UsaStockRankedRow[] | null>(null)
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

  // Shared by the Overview "Add Stock" search and the Analyse tab's search --
  // validates+persists via POST /custom (backend resolves it through
  // yfinance), then selects it so Analyse/the chart pick it up immediately.
  const addAndSelectStock = useCallback(async (code: string) => {
    const token = tokenRef.current
    if (!token || !code) return
    await addUsaStock(token, code)
    setSelectedStock(code)
    await Promise.all([loadQuotes(), loadRanked()])
  }, [loadQuotes, loadRanked])

  const handleRemove = useCallback(async (code: string) => {
    const token = tokenRef.current
    if (!token) return
    try {
      await removeUsaStock(token, code)
      if (selectedStock === code) setSelectedStock('AAPL')
      await Promise.all([loadQuotes(), loadRanked()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove stock')
    }
  }, [selectedStock, loadQuotes, loadRanked])

  const selectedQuote = quotes?.find(q => q.code === selectedStock) ?? null

  // Heat map ranked by day % change (best performer first) -- same
  // rank-tiered coloring as Crypto/My Trading Dashboard, no AI score yet.
  const heatRanked = useMemo(
    () => [...(quotes ?? [])].sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity)),
    [quotes],
  )

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

        <div className="mb-6 flex items-center gap-1">
          {MAIN_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors"
              style={tab === t.id
                ? { background: '#4f46e5', color: '#fff' }
                : { background: '#e4e4e7', color: '#52525b' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'analyse' ? (
          <AnalyseStockTab
            quotes={quotes}
            selectedStock={selectedStock}
            onSelectStock={setSelectedStock}
            onAddStock={addAndSelectStock}
          />
        ) : tab === 'top-picks' ? (
          <TopPicksTab onAnalyse={code => { setSelectedStock(code); setTab('analyse') }} />
        ) : (
          <>
            <div className="mb-4">
              <TickerAddSearch onAdd={addAndSelectStock} placeholder="Add ticker or company name, e.g. UBER" />
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
          </>
        )}
      </div>
    </div>
  )
}

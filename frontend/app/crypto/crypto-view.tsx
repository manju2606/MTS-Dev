'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import {
  getCryptoQuotes, getCryptoOhlc, getCryptoPredict, getCryptoRanked,
} from '@/lib/api'
import type {
  CryptoQuote, CryptoCoin, CryptoOhlcPeriod, CryptoRankedPeriod, CryptoRankedRow, HistoryBar, ChartPeriod,
} from '@/lib/api'
import type { PredictionPoint } from '@/components/price-chart'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const QUOTES_CACHE_KEY = 'crypto:quotes'
const RANKED_CACHE_KEY = 'crypto:ranked'
const QUOTES_POLL_MS = 30_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Same rank-tiered palette as My Trading Dashboard (matching
// AI_Commodity_Trading_Dashboard_Pro_v3.html): best performer emerald,
// worst dark red. Crypto has no AI score yet, so rank here is by 24H %
// change instead of AI Strength -- same "heat map" idea, different metric.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f', '#b45309', '#991b1b']
function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

// Binance's own klines intervals -- the full set, unlike MCX's period
// system which is fixed to Kite's own intervals (see PriceChart's
// periodBucketSeconds/defaultVisibleBars overrides below for why "30m"/
// "1W"/"1M" need different bucket widths here than MCX uses for the same
// labels).
const CHART_PERIODS: CryptoOhlcPeriod[] = ['1m', '5m', '15m', '30m', '1h', '4h', '8h', '1D', '1W', '1M']
const RANKED_PERIODS: CryptoRankedPeriod[] = ['15m', '1h', '1D']

// Real Binance candle-bucket widths, overriding PriceChart's MCX-flavoured
// defaults for the labels that mean something different for crypto: MCX's
// "30m" is resampled from 15-min Kite candles (900s roll-over), but
// Binance gives a genuine 30-min candle (1800s); MCX's "1W"/"1M" are
// daily-resampled views (86400s), but Binance gives true weekly/monthly
// candles.
const CRYPTO_BUCKET_SECONDS: Partial<Record<ChartPeriod, number>> = {
  '30m': 1800, '1W': 604800, '1M': 2592000,
}
const CRYPTO_VISIBLE_BARS: Partial<Record<ChartPeriod, number>> = {
  '1m': 60, '5m': 60, '15m': 60, '30m': 48, '1h': 48, '4h': 40, '8h': 24, '1D': 30, '1W': 20, '1M': 12,
}

function fmtInr(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function fmtUsd(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtCompact(v: number | null): string {
  if (v === null) return '—'
  if (v >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `₹${(v / 1e9).toFixed(2)}B`
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  return `₹${v.toLocaleString('en-IN')}`
}

function HeatTile({
  quote, rank, selected, onClick,
}: { quote: CryptoQuote; rank: number; selected: boolean; onClick: () => void }) {
  const pct = quote.change_pct_24h
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
      <p className="mt-1 truncate text-xs font-normal opacity-80">{quote.name}</p>
      <p className="mt-2 text-lg font-extrabold">₹{fmtInr(quote.price)}</p>
      <p className="text-xs font-normal opacity-90">${fmtUsd(quote.price_usd)}</p>
      <p className="text-xs">
        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'} &middot; 24H
      </p>
    </button>
  )
}

// Magnitude highlight (independent of sign): >3-5% yellow, >5-10% light
// blue, >10% light green -- same bands as My Trading Dashboard's predicted-
// price cells.
function magnitudeHighlight(pct: number): string | null {
  const abs = Math.abs(pct)
  if (abs > 10) return '#4ade80'
  if (abs > 5) return '#38bdf8'
  if (abs > 3) return '#facc15'
  return null
}

// Predicted prices come from Binance (USD-denominated candles, see
// binance_service.py), not CoinGecko's INR quotes -- comparing against
// row.price (INR) instead of row.price_usd here previously produced a
// nonsensical ~-99% "change" (INR values run ~83x larger than USD for
// the same real price). $, not ₹, for both the prefix and the % base.
function PredictedCell({ predicted, priceUsd }: { predicted: number | null; priceUsd: number | null }) {
  if (predicted === null) return <span className="text-zinc-400">—</span>
  const pct = priceUsd ? ((predicted - priceUsd) / priceUsd) * 100 : null
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

function RankedPredictionTable({ rows }: { rows: CryptoRankedRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Rank', 'Coin', 'LTP (₹)', 'LTP ($)', 'Chg%', '15m', '1H', '1D'].map(h => (
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
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">₹{fmtInr(row.price)}</td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">${fmtUsd(row.price_usd)}</td>
              <td className="px-3 py-2">
                {row.change_pct_24h !== null ? (
                  <span className={row.change_pct_24h >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
                    {row.change_pct_24h >= 0 ? '+' : ''}{row.change_pct_24h.toFixed(2)}%
                  </span>
                ) : '—'}
              </td>
              {RANKED_PERIODS.map(p => (
                <td key={p} className="whitespace-nowrap px-3 py-2">
                  <PredictedCell predicted={row.predicted[p]} priceUsd={row.price_usd} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CryptoView() {
  const [quotes, setQuotes] = useState<CryptoQuote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedCoin, setSelectedCoin] = useState<CryptoCoin>('BTC')
  const [chartPeriod, setChartPeriod] = useState<CryptoOhlcPeriod>('30m')
  const [ohlc, setOhlc] = useState<HistoryBar[]>([])
  const [prediction, setPrediction] = useState<PredictionPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [ranked, setRanked] = useState<CryptoRankedRow[] | null>(null)
  const tokenRef = useRef('')

  const loadQuotes = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getCryptoQuotes(token)
      setQuotes(res)
      writePageCache(QUOTES_CACHE_KEY, res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load crypto quotes')
    }
  }, [])

  const loadRanked = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getCryptoRanked(token)
      setRanked(res.ranked)
      writePageCache(RANKED_CACHE_KEY, res.ranked)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load ranked predictions')
      // Without this, a failed request leaves `ranked` at its initial null
      // forever, so the table's loading spinner never resolves even though
      // the error banner above already reported the failure.
      setRanked(prev => prev ?? [])
    }
  }, [])

  const loadChart = useCallback(async (coin: CryptoCoin, period: CryptoOhlcPeriod) => {
    const token = tokenRef.current
    if (!token) return
    setChartLoading(true)
    try {
      const [bars, pred] = await Promise.all([
        getCryptoOhlc(token, coin, period),
        getCryptoPredict(token, coin, period),
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
    const cachedQuotes = readPageCache<CryptoQuote[]>(QUOTES_CACHE_KEY)
    const cachedRanked = readPageCache<CryptoRankedRow[]>(RANKED_CACHE_KEY)
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
    loadChart(selectedCoin, chartPeriod).catch(() => {})
  }, [selectedCoin, chartPeriod, loadChart])

  const selectedQuote = quotes?.find(q => q.code === selectedCoin) ?? null

  // Heat map ranked by 24H % change (best performer first) -- same
  // rank-tiered coloring as My Trading Dashboard, just a different metric
  // since crypto has no AI score yet.
  const heatRanked = useMemo(
    () => [...(quotes ?? [])].sort((a, b) => (b.change_pct_24h ?? -Infinity) - (a.change_pct_24h ?? -Infinity)),
    [quotes],
  )

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Crypto" />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">🪙 Crypto</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Live prices via CoinGecko (₹ &amp; $) &middot; quotes refresh every {QUOTES_POLL_MS / 1000}s.
            Chart candles are from Binance (USD pairs, 1m-1M real timeframes). Prediction is the same local
            heuristic MCX uses (EMA slope + ROC momentum + ATR cone), not a trained model &mdash; still no
            paper trading yet.
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
              🔥 24H Performance Heat Map
            </h2>
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {heatRanked.map((q, i) => (
                <HeatTile key={q.code} quote={q} rank={i} selected={q.code === selectedCoin} onClick={() => setSelectedCoin(q.code)} />
              ))}
            </div>

            <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              📊 Ranked Crypto Prediction
            </h2>
            {ranked === null ? (
              <div className="mb-8 flex justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
            ) : (
              <div className="mb-8">
                <RankedPredictionTable rows={ranked} />
                <p className="mt-2 text-xs text-zinc-400">
                  Predicted prices are kept warm by a background job every ~4 min (same pattern MCX uses) so
                  this loads fast &mdash; a dash (—) means that coin/period hasn&apos;t been refreshed yet or hit
                  CoinGecko&apos;s rate limit; it&apos;ll usually resolve within a few minutes.
                </p>
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {selectedQuote?.name ?? selectedCoin} Price Chart
                </h2>
                {selectedQuote && (
                  <p className="mt-0.5 text-xs text-zinc-400">
                    ₹{fmtInr(selectedQuote.price)} (${fmtUsd(selectedQuote.price_usd)}) &middot; 24H High ₹{fmtInr(selectedQuote.high_24h)}
                    {' '}&middot; 24H Low ₹{fmtInr(selectedQuote.low_24h)} &middot; Mkt Cap {fmtCompact(selectedQuote.market_cap)}
                    {' '}&middot; Vol {fmtCompact(selectedQuote.volume_24h)}
                  </p>
                )}
              </div>
            </div>

            <PriceChart
              symbol={selectedCoin}
              data={ohlc}
              period={chartPeriod}
              onPeriodChange={p => setChartPeriod(p as CryptoOhlcPeriod)}
              periods={CHART_PERIODS}
              periodBucketSeconds={CRYPTO_BUCKET_SECONDS}
              defaultVisibleBars={CRYPTO_VISIBLE_BARS}
              loading={chartLoading}
              currentPrice={selectedQuote?.price_usd ?? null}
              exchangeLabel="Binance"
              currencySymbol="$"
              prediction={prediction}
            />
          </>
        )}
      </div>
    </div>
  )
}

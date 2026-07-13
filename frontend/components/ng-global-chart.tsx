'use client'

import { useEffect, useState } from 'react'
import { PriceChart } from '@/components/price-chart'
import type { PredictionPoint } from '@/components/price-chart'
import { getNgGlobalHistory, getNgGlobalPrediction } from '@/lib/api'
import type { HistoryBar, NgPrediction, ChartPeriod } from '@/lib/api'

// Henry Hub (NYMEX) Natural Gas via yfinance -- daily-only (no free
// intraday source), so unlike NgChart there's no real period selector;
// PriceChart still requires period/onPeriodChange props, so this pins them
// to a single "1D" option instead of MCX's full 1m-1Y set.
const GLOBAL_PERIODS: ChartPeriod[] = ['1D']

// Was previously a TradingView hosted-widget iframe -- that's a locked
// cross-origin embed with no way to draw our own AI prediction overlay on
// top of it, so this switched to our own PriceChart (same component NgChart
// uses) fed with real Henry Hub candles, to get the prediction line back.
export function NgGlobalChart() {
  const [bars, setBars] = useState<HistoryBar[]>([])
  const [loading, setLoading] = useState(true)
  const [prediction, setPrediction] = useState<NgPrediction | null>(null)
  const [period, setPeriod] = useState<ChartPeriod>('1D')

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true)
    let first = true
    function load() {
      getNgGlobalHistory(t)
        .then(setBars)
        .catch(() => { if (first) setBars([]) })
        .finally(() => { setLoading(false); first = false })
    }
    load()
    // Henry Hub is daily-only data -- refetching every 30s like the MCX
    // intraday chart does would be pointless; this just needs to catch the
    // still-forming last daily bar moving and any new day rolling in.
    const id = setInterval(load, 300_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getNgGlobalPrediction(t).then(setPrediction).catch(() => {})
    }
    load()
    const id = setInterval(load, 300_000)
    return () => clearInterval(id)
  }, [])

  // Same history+predicted merge/de-dupe NgChart does -- lightweight-charts
  // requires strictly ordered, unique points per line series.
  const predictionPoints: PredictionPoint[] = prediction
    ? Array.from(
        [...prediction.history, ...prediction.predicted]
          .reduce((map, p) => {
            map.set(p.time, { time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower })
            return map
          }, new Map<number, PredictionPoint>())
          .values(),
      ).sort((a, b) => a.time - b.time)
    : []

  const acc = prediction?.accuracy
  const lastClose = bars.length ? bars[bars.length - 1].close : null

  return (
    <div className="space-y-2">
      <PriceChart
        symbol="Henry Hub Natural Gas (NG=F)"
        data={bars}
        period={period}
        onPeriodChange={setPeriod}
        periods={GLOBAL_PERIODS}
        loading={loading}
        currentPrice={lastClose}
        exchangeLabel="NYMEX"
        prediction={predictionPoints}
        currencySymbol="$"
      />
      {prediction?.note ? (
        <p className="text-[11px] text-zinc-400">{prediction.note}</p>
      ) : prediction && (
        <p className="text-[11px] text-zinc-400">
          Purple line is the AI prediction (daily horizon, local heuristic — not a trading signal on its own).
          {acc && acc.sample_size > 0 ? (
            <> Tracked {acc.sample_size} past predictions &middot; <span className="font-semibold text-zinc-600 dark:text-zinc-300">{acc.hit_rate_pct?.toFixed(1)}%</span> landed within band &middot; avg error {acc.avg_error_pct?.toFixed(2)}%.</>
          ) : (
            ' Accuracy tracking builds up as time passes each predicted day.'
          )}
        </p>
      )}
      <p className="text-xs text-zinc-400">
        Henry Hub Natural Gas (NYMEX) daily price via Yahoo Finance — free data, daily bars only (no intraday).
        Prediction is a shared local heuristic (EMA slope + momentum + ATR cone) tracked across all users, since
        this is public market data rather than your own MCX/Kite feed.
      </p>
    </div>
  )
}

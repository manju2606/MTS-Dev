'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp } from 'lightweight-charts'
import type { HistoryBar, ChartPeriod } from '@/lib/api'

export type AILevels = {
  signal: 'BUY' | 'SELL' | 'HOLD'
  entry: number
  stopLoss: number
  target: number
} | null

export type RefLine = { price: number; label: string }
export type PredictionPoint = { time: number; predictedClose: number; upper: number; lower: number }

type LiveBar = { time: UTCTimestamp; open: number; high: number; low: number; close: number }

type PriceChartProps = {
  symbol: string
  data: HistoryBar[]
  period: ChartPeriod
  onPeriodChange: (p: ChartPeriod) => void
  loading: boolean
  aiLevels?: AILevels
  currentPrice?: number | null
  exchangeLabel?: string
  refLines?: RefLine[]
  prediction?: PredictionPoint[]
}

const PERIODS: ChartPeriod[] = ['1m', '5m', '15m', '30m', '45m', '1h', '1D', '5D', '1W', '1M', '3M', '6M', '1Y']

// Real candle-bucket width in seconds for each period, matching the actual
// server-side interval (e.g. "30m" is rendered from 15-minute candles, not
// 30-minute ones) -- needed so the live-updated "in progress" bar rolls over
// to a new bucket at the right moment instead of drifting further from the
// true current time the longer a tab stays open without a period switch.
const PERIOD_BUCKET_SECONDS: Record<ChartPeriod, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 900, '45m': 3600, '1h': 3600,
  '1D': 86400, '5D': 86400, '1W': 86400, '1M': 86400, '3M': 86400, '6M': 86400, '1Y': 86400,
}

// Default zoomed-in window (number of most-recent bars) shown on load, per
// period -- the backend fetches a much longer lookback than this so trend
// indicators/predictions have enough history, but fitting *all* of that into
// view (e.g. ~600+ hourly candles for "1h", 90 days back) makes the chart
// unreadably zoomed out. Periods not listed here (1D and longer) fit all
// fetched bars, since those are meant to be zoomed-out overview views.
// Users can still scroll/zoom out manually afterwards.
const DEFAULT_VISIBLE_BARS: Partial<Record<ChartPeriod, number>> = {
  '1m': 120, '5m': 100, '15m': 80, '30m': 60, '45m': 60, '1h': 48,
}

export function PriceChart({ symbol, data, period, onPeriodChange, loading, aiLevels, currentPrice, exchangeLabel, refLines, prediction }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ltpLineRef = useRef<IPriceLine | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const lastBarRef = useRef<LiveBar | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const refLinesKey = JSON.stringify(refLines ?? [])
  const predictionKey = JSON.stringify(prediction ?? [])

  const positionBall = useCallback((price: number | null | undefined) => {
    const series = candleSeriesRef.current
    const chart = chartRef.current
    const ball = ballRef.current
    const bar = lastBarRef.current
    if (!series || !chart || !ball || !bar || price == null) {
      if (ball) ball.style.opacity = '0'
      return
    }
    const y = series.priceToCoordinate(price)
    const x = chart.timeScale().timeToCoordinate(bar.time)
    if (y == null || x == null) {
      ball.style.opacity = '0'
      return
    }
    ball.style.left = `${x}px`
    ball.style.top = `${y}px`
    ball.style.opacity = '1'
  }, [])

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === cardRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      cardRef.current?.requestFullscreen()
    }
  }

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    // Lazy-import to avoid SSR issues
    import('lightweight-charts').then(
      ({ createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle, createSeriesMarkers }) => {
        if (!containerRef.current) return

        // Remove previous chart instance
        if (chartRef.current) {
          chartRef.current.remove()
          chartRef.current = null
        }

        const isDark = document.documentElement.classList.contains('dark')
        const bg = isDark ? '#18181b' : '#ffffff'
        const textColor = isDark ? '#a1a1aa' : '#71717a'
        const gridColor = isDark ? '#27272a' : '#f4f4f5'

        const chart = createChart(containerRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: bg },
            textColor,
            fontSize: 11,
          },
          grid: {
            vertLines: { color: gridColor },
            horzLines: { color: gridColor },
          },
          crosshair: { mode: CrosshairMode.Normal },
          leftPriceScale: { visible: true, borderVisible: false },
          rightPriceScale: { visible: false },
          // rightOffset leaves empty space past the last plotted point (real
          // candle, or the last predicted point when a prediction is shown)
          // so the AI prediction line has visible room to breathe on the
          // right instead of hugging the edge of the chart.
          timeScale: { borderVisible: false, timeVisible: true, rightOffset: 8 },
          width: containerRef.current.clientWidth,
          height: 300,
        })

        chartRef.current = chart

        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10b981',
          downColor: '#ef4444',
          borderUpColor: '#10b981',
          borderDownColor: '#ef4444',
          wickUpColor: '#10b981',
          wickDownColor: '#ef4444',
          priceScaleId: 'left',
        })
        candleSeriesRef.current = candleSeries
        ltpLineRef.current = null

        const volSeries = chart.addSeries(HistogramSeries, {
          color: '#6366f140',
          priceScaleId: 'vol',
        })

        chart.priceScale('vol').applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
          visible: false,
        })

        candleSeries.setData(
          data.map(b => ({
            time: b.time as UTCTimestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          })),
        )

        volSeries.setData(
          data.map(b => ({
            time: b.time as UTCTimestamp,
            value: b.volume,
            color: b.close >= b.open ? '#10b98140' : '#ef444440',
          })),
        )

        // AI buy/sell levels overlay — entry/stop-loss/target lines + a signal marker
        if (aiLevels && aiLevels.signal !== 'HOLD') {
          const dir = aiLevels.signal === 'BUY' ? 1 : -1
          const fmtPnl = (price: number) => {
            const pts = (price - aiLevels.entry) * dir
            const pct = (pts / aiLevels.entry) * 100
            const sign = pts >= 0 ? '+' : ''
            return `${sign}${pts.toFixed(2)} (${sign}${pct.toFixed(1)}%)`
          }

          candleSeries.createPriceLine({
            price: aiLevels.entry,
            color: '#2563eb',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Entry (${aiLevels.signal})`,
          })
          candleSeries.createPriceLine({
            price: aiLevels.stopLoss,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Stop Loss ${fmtPnl(aiLevels.stopLoss)}`,
          })
          candleSeries.createPriceLine({
            price: aiLevels.target,
            color: '#10b981',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Target ${fmtPnl(aiLevels.target)}`,
          })

          const lastBar = data[data.length - 1]
          if (lastBar) {
            createSeriesMarkers(candleSeries, [{
              time: lastBar.time as UTCTimestamp,
              position: aiLevels.signal === 'BUY' ? 'belowBar' : 'aboveBar',
              color: aiLevels.signal === 'BUY' ? '#2563eb' : '#ef4444',
              shape: aiLevels.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
              text: aiLevels.signal,
            }])
          }
        }

        // Reference lines (day/week/month high-low, etc.) — flat black dotted
        // lines, independent of the AI signal overlay.
        const isDarkTheme = document.documentElement.classList.contains('dark')
        const refLineColor = isDarkTheme ? '#e4e4e7' : '#18181b'
        for (const rl of refLines ?? []) {
          candleSeries.createPriceLine({
            price: rl.price,
            color: refLineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${rl.label} ₹${rl.price.toFixed(2)}`,
          })
        }

        // AI price prediction — a distinct-colour line spanning the full
        // prediction trail (past predictions the caller merged in, plus the
        // current forward forecast), with a dotted upper/lower uncertainty
        // band. Same 'left' price scale as the candles so it lines up
        // visually with the actual price axis. The caller is responsible for
        // sorting ascending and de-duplicating by time -- lightweight-charts
        // requires strictly ordered, unique points per series.
        if (prediction && prediction.length > 0) {
          const predictedSeries = chart.addSeries(LineSeries, {
            color: '#a855f7',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceScaleId: 'left',
            title: 'AI Prediction',
          })
          predictedSeries.setData(prediction.map(p => ({ time: p.time as UTCTimestamp, value: p.predictedClose })))

          const bandOpts = { color: '#a855f766', lineWidth: 1 as const, lineStyle: LineStyle.Dotted, priceScaleId: 'left' as const }
          const upperSeries = chart.addSeries(LineSeries, { ...bandOpts, title: 'Prediction upper' })
          upperSeries.setData(prediction.map(p => ({ time: p.time as UTCTimestamp, value: p.upper })))
          const lowerSeries = chart.addSeries(LineSeries, { ...bandOpts, title: 'Prediction lower' })
          lowerSeries.setData(prediction.map(p => ({ time: p.time as UTCTimestamp, value: p.lower })))
        }

        // LTP line — current/live price, kept separate from the AI levels so it can be
        // nudged on each price poll (see the effect below) without rebuilding the chart.
        if (currentPrice != null) {
          ltpLineRef.current = candleSeries.createPriceLine({
            price: currentPrice,
            color: '#f59e0b',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `LTP ₹${currentPrice.toFixed(2)}`,
          })
        }

        const lastRaw = data[data.length - 1]
        lastBarRef.current = lastRaw
          ? { time: lastRaw.time as UTCTimestamp, open: lastRaw.open, high: lastRaw.high, low: lastRaw.low, close: lastRaw.close }
          : null

        // Centre the last real candle in the viewport -- equal history on
        // the left, equal reserved space (mostly the AI prediction) on the
        // right, rather than history dominating and prediction squeezed
        // into a sliver at the edge. Uses actual timestamps, not logical
        // bar indices: the prediction series adds its own time points (many
        // of which don't line up with real candle times across session
        // gaps), which inflates the chart's shared logical-index axis past
        // data.length and threw off index-based range math -- including
        // where the LTP ball ended up, since it's positioned by looking up
        // its bar's time on that same (miscounted) axis.
        const visibleBars = DEFAULT_VISIBLE_BARS[period]
        if (visibleBars && lastRaw) {
          const bucket = PERIOD_BUCKET_SECONDS[period] ?? 86400
          const span = visibleBars * bucket
          chart.timeScale().setVisibleRange({
            from: (lastRaw.time - span) as UTCTimestamp,
            to: (lastRaw.time + span) as UTCTimestamp,
          })
        } else {
          chart.timeScale().fitContent()
        }
        positionBall(currentPrice)

        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            })
            positionBall(currentPrice)
          }
        })
        ro.observe(containerRef.current)

        return () => ro.disconnect()
      },
    )

    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
      candleSeriesRef.current = null
      ltpLineRef.current = null
      lastBarRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, aiLevels, refLinesKey, predictionKey, period, positionBall])

  // Live tick handling — nudges the LTP line, extends the in-progress last
  // candle (high/low/close) in place via .update() so the chart feels
  // real-time without a full re-fetch/rebuild, and moves the pulsing ball
  // marker to track the current price at the latest bar's position.
  useEffect(() => {
    if (currentPrice == null || !candleSeriesRef.current) return

    if (lastBarRef.current) {
      const bar = lastBarRef.current
      const bucket = PERIOD_BUCKET_SECONDS[period] ?? 86400
      const nowSec = Math.floor(Date.now() / 1000)
      const elapsed = nowSec - bar.time

      let updated: LiveBar
      if (elapsed >= bucket) {
        // Real time has moved past this bar's bucket -- start a new forming
        // candle rather than keep stretching a stale one forever. The new
        // boundary is derived by stepping forward from the last known-good
        // (server-provided) bucket start, not recomputed from wall-clock
        // epoch math, so it stays aligned with exchange session offsets
        // (e.g. NSE/MCX sessions start at 9:15 IST, not on a clean UTC hour).
        const periodsElapsed = Math.floor(elapsed / bucket)
        const newTime = (bar.time + periodsElapsed * bucket) as UTCTimestamp
        updated = { time: newTime, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice }
      } else {
        updated = {
          time: bar.time,
          open: bar.open,
          high: Math.max(bar.high, currentPrice),
          low: Math.min(bar.low, currentPrice),
          close: currentPrice,
        }
      }
      lastBarRef.current = updated
      candleSeriesRef.current.update(updated)
    }

    if (ltpLineRef.current) {
      ltpLineRef.current.applyOptions({ price: currentPrice, title: `LTP ₹${currentPrice.toFixed(2)}` })
    } else {
      import('lightweight-charts').then(({ LineStyle }) => {
        if (!candleSeriesRef.current || ltpLineRef.current) return
        ltpLineRef.current = candleSeriesRef.current.createPriceLine({
          price: currentPrice,
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `LTP ₹${currentPrice.toFixed(2)}`,
        })
      })
    }

    positionBall(currentPrice)
  }, [currentPrice, period, positionBall])

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
        fullscreen ? 'flex h-screen flex-col' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {symbol.replace(/\.(NS|BO)$/, '')}
          <span className="ml-2 text-xs font-normal text-zinc-400">
            {exchangeLabel ?? (symbol.endsWith('.BO') ? 'BSE' : 'NSE')}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit full view' : 'Full view'}
            className="ml-1 rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className={`relative ${fullscreen ? 'flex-1' : 'h-[320px]'}`}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70">
            <span className="text-sm text-zinc-400">Loading chart…</span>
          </div>
        )}
        {data.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-zinc-400">No data</span>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div
          ref={ballRef}
          className="pointer-events-none absolute z-20 opacity-0 transition-all duration-300 ease-out"
          style={{ transform: 'translate(-50%, -50%)', left: 0, top: 0 }}
        >
          <span className="absolute -inset-1.5 animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative block h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)] ring-2 ring-white dark:ring-zinc-900" />
        </div>
      </div>
    </div>
  )
}

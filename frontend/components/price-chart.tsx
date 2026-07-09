'use client'

import { useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp } from 'lightweight-charts'
import type { HistoryBar, ChartPeriod } from '@/lib/api'

export type AILevels = {
  signal: 'BUY' | 'SELL' | 'HOLD'
  entry: number
  stopLoss: number
  target: number
} | null

type PriceChartProps = {
  symbol: string
  data: HistoryBar[]
  period: ChartPeriod
  onPeriodChange: (p: ChartPeriod) => void
  loading: boolean
  aiLevels?: AILevels
  currentPrice?: number | null
  exchangeLabel?: string
  dayHigh?: number | null
  dayLow?: number | null
}

const PERIODS: ChartPeriod[] = ['1m', '5m', '15m', '30m', '45m', '1h', '1D', '5D', '1W', '1M', '3M', '6M', '1Y']

export function PriceChart({ symbol, data, period, onPeriodChange, loading, aiLevels, currentPrice, exchangeLabel, dayHigh, dayLow }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ltpLineRef = useRef<IPriceLine | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

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
      ({ createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle, createSeriesMarkers }) => {
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
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true },
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

        // Day high/low — flat black reference lines, independent of the AI
        // signal (still shown even when there's no active BUY/SELL overlay).
        const isDarkTheme = document.documentElement.classList.contains('dark')
        const dayLineColor = isDarkTheme ? '#e4e4e7' : '#18181b'
        if (dayHigh != null) {
          candleSeries.createPriceLine({
            price: dayHigh,
            color: dayLineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `Day High ₹${dayHigh.toFixed(2)}`,
          })
        }
        if (dayLow != null) {
          candleSeries.createPriceLine({
            price: dayLow,
            color: dayLineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `Day Low ₹${dayLow.toFixed(2)}`,
          })
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

        chart.timeScale().fitContent()

        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            })
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
    }
  }, [data, aiLevels, dayHigh, dayLow])

  // Nudge the LTP line on each live-price update without rebuilding the whole chart.
  useEffect(() => {
    if (currentPrice == null || !candleSeriesRef.current) return
    if (ltpLineRef.current) {
      ltpLineRef.current.applyOptions({ price: currentPrice, title: `LTP ₹${currentPrice.toFixed(2)}` })
      return
    }
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
  }, [currentPrice])

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
      </div>
    </div>
  )
}

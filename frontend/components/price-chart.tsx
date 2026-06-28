'use client'

import { useEffect, useRef } from 'react'
import type { IChartApi, UTCTimestamp } from 'lightweight-charts'
import type { HistoryBar, ChartPeriod } from '@/lib/api'

type PriceChartProps = {
  symbol: string
  data: HistoryBar[]
  period: ChartPeriod
  onPeriodChange: (p: ChartPeriod) => void
  loading: boolean
}

const PERIODS: ChartPeriod[] = ['1W', '1M', '3M', '6M', '1Y']

export function PriceChart({ symbol, data, period, onPeriodChange, loading }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    // Lazy-import to avoid SSR issues
    import('lightweight-charts').then(
      ({ createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode }) => {
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

        chart.timeScale().fitContent()

        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
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
    }
  }, [data])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {symbol.replace(/\.(NS|BO)$/, '')}
          <span className="ml-2 text-xs font-normal text-zinc-400">
            {symbol.endsWith('.BO') ? 'BSE' : 'NSE'}
          </span>
        </span>
        <div className="flex gap-1">
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
        </div>
      </div>

      <div className="relative h-[320px]">
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

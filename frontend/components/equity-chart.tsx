'use client'

import { useEffect, useRef } from 'react'
import type { IChartApi, UTCTimestamp } from 'lightweight-charts'
import type { EquityPoint } from '@/lib/api'

type EquityChartProps = {
  data: EquityPoint[]
}

export function EquityChart({ data }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    import('lightweight-charts').then(({ createChart, AreaSeries, ColorType }) => {
      if (!containerRef.current) return
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

      const isDark = document.documentElement.classList.contains('dark')
      const bg = isDark ? '#18181b' : '#ffffff'
      const grid = isDark ? '#27272a' : '#f4f4f5'
      const textColor = isDark ? '#a1a1aa' : '#71717a'

      const isProfit = data[data.length - 1]?.value >= 0
      const lineColor = isProfit ? '#10b981' : '#ef4444'
      const topColor = isProfit ? '#10b98130' : '#ef444430'

      const chart = createChart(containerRef.current, {
        layout: { background: { type: ColorType.Solid, color: bg }, textColor, fontSize: 11 },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: false },
        width: containerRef.current.clientWidth,
        height: 180,
      })
      chartRef.current = chart

      const series = chart.addSeries(AreaSeries, {
        lineColor,
        topColor,
        bottomColor: 'transparent',
        lineWidth: 2,
      })

      series.setData(data.map(p => ({ time: p.time as UTCTimestamp, value: p.value })))
      chart.timeScale().fitContent()

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
        }
      })
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    })

    return () => { if (chartRef.current) { chartRef.current.remove(); chartRef.current = null } }
  }, [data])

  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-400">No closed trades yet — equity curve will appear here</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Equity Curve</p>
        <p className="text-xs text-zinc-400">Cumulative realized P&amp;L from closed trades</p>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 180 }} />
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getCryptoQuotes, getCryptoHistory } from '@/lib/api'
import type { CryptoQuote, CryptoCoin, CryptoHistoryPoint } from '@/lib/api'

const QUOTES_POLL_MS = 30_000

const DAY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '24H' },
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '365', label: '1Y' },
]

function fmtInr(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function fmtCompact(v: number | null): string {
  if (v === null) return '—'
  if (v >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `₹${(v / 1e9).toFixed(2)}B`
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  return `₹${v.toLocaleString('en-IN')}`
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-zinc-400">—</span>
  const pos = pct >= 0
  return (
    <span className={`text-xs font-semibold ${pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function QuoteCard({ quote, selected, onClick }: { quote: CryptoQuote; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start rounded-2xl border p-4 text-left transition-colors ${
        selected
          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30'
          : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{quote.code}</span>
        {quote.market_cap_rank && (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            #{quote.market_cap_rank}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-zinc-400">{quote.name}</p>
      <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">₹{fmtInr(quote.price)}</p>
      <PctBadge pct={quote.change_pct_24h} />
    </button>
  )
}

function CryptoChart({ points, coin }: { points: CryptoHistoryPoint[]; coin: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<import('lightweight-charts').IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return

    import('lightweight-charts').then(({ createChart, AreaSeries, ColorType, CrosshairMode }) => {
      if (!containerRef.current) return
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

      const isDark = document.documentElement.classList.contains('dark')
      const bg = isDark ? '#18181b' : '#ffffff'
      const textColor = isDark ? '#a1a1aa' : '#71717a'
      const gridColor = isDark ? '#27272a' : '#f4f4f5'

      const chart = createChart(containerRef.current, {
        layout: { background: { type: ColorType.Solid, color: bg }, textColor, fontSize: 11 },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true },
        width: containerRef.current.clientWidth,
        height: 340,
      })
      chartRef.current = chart

      const series = chart.addSeries(AreaSeries, {
        lineColor: '#6366f1',
        topColor: 'rgba(99, 102, 241, 0.35)',
        bottomColor: 'rgba(99, 102, 241, 0.02)',
        lineWidth: 2,
      })
      series.setData(points.map(p => ({ time: p.time as import('lightweight-charts').UTCTimestamp, value: p.price })))
      chart.timeScale().fitContent()

      const onResize = () => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    })

    return () => {
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    }
  }, [points, coin])

  return <div ref={containerRef} className="w-full" />
}

export default function CryptoView() {
  const [quotes, setQuotes] = useState<CryptoQuote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedCoin, setSelectedCoin] = useState<CryptoCoin>('BTC')
  const [days, setDays] = useState('1')
  const [history, setHistory] = useState<CryptoHistoryPoint[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const tokenRef = useRef('')

  const loadQuotes = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      setQuotes(await getCryptoQuotes(token))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load crypto quotes')
    }
  }, [])

  const loadHistory = useCallback(async (coin: CryptoCoin, d: string) => {
    const token = tokenRef.current
    if (!token) return
    setHistoryLoading(true)
    try {
      setHistory(await getCryptoHistory(token, coin, d))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load price history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    loadQuotes().catch(() => {})
    const id = setInterval(() => { loadQuotes().catch(() => {}) }, QUOTES_POLL_MS)
    return () => clearInterval(id)
  }, [loadQuotes])

  useEffect(() => {
    loadHistory(selectedCoin, days).catch(() => {})
  }, [selectedCoin, days, loadHistory])

  const selectedQuote = quotes?.find(q => q.code === selectedCoin) ?? null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Crypto" />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">🪙 Crypto</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Live prices via CoinGecko &middot; quotes refresh every {QUOTES_POLL_MS / 1000}s. No AI score, predictions,
            or paper trading yet &mdash; quotes and price chart only.
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
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {(quotes ?? []).map(q => (
                <QuoteCard key={q.code} quote={q} selected={q.code === selectedCoin} onClick={() => setSelectedCoin(q.code)} />
              ))}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {selectedQuote?.name ?? selectedCoin} Price Chart
                  </h2>
                  {selectedQuote && (
                    <p className="mt-0.5 text-xs text-zinc-400">
                      ₹{fmtInr(selectedQuote.price)} &middot; 24H High ₹{fmtInr(selectedQuote.high_24h)} &middot;
                      {' '}24H Low ₹{fmtInr(selectedQuote.low_24h)} &middot; Mkt Cap {fmtCompact(selectedQuote.market_cap)}
                      {' '}&middot; Vol {fmtCompact(selectedQuote.volume_24h)}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
                  {DAY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setDays(opt.value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        days === opt.value
                          ? 'bg-indigo-600 text-white'
                          : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {historyLoading && !history ? (
                <div className="flex h-[340px] items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                </div>
              ) : (
                <CryptoChart points={history ?? []} coin={selectedCoin} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

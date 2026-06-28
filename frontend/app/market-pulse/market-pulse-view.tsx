'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getMarketPulse, addToWatchlist } from '@/lib/api'
import type { MarketPulseResult, PulseCard } from '@/lib/api'

const SECTORS = ['all', 'Banking', 'IT', 'Pharma', 'Auto', 'FMCG', 'Metal', 'Energy', 'Infra', 'Finance', 'Realty', 'Consumer', 'Telecom']

const TAG_COLORS: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  red:   'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  blue:  'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  zinc:  'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

const SECTOR_COLOR: Record<string, string> = {
  bullish: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  bearish: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  neutral: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

function ConfBar({ v, color = 'bg-indigo-500' }: { v: number; color?: string }) {
  const pct = Math.round(v * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] text-zinc-400">{pct}%</span>
    </div>
  )
}

function PulseCardView({ card, type, onWatch }: { card: PulseCard; type: 'buy' | 'sell'; onWatch: (s: string) => void }) {
  const sym = card.symbol.replace(/\.(NS|BO)$/, '')
  const isBuy = type === 'buy'
  const rrColor = card.risk_reward_ratio >= 2 ? 'text-emerald-600 dark:text-emerald-400'
    : card.risk_reward_ratio >= 1.5 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-500 dark:text-red-400'

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${isBuy ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {card.sector}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-400 truncate max-w-[160px]">{card.name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${isBuy ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800' : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'}`}>
            {card.signal}
          </span>
          <span className="text-[10px] text-zinc-400">{card.engine === 'claude' ? '✦ Claude' : 'Rule-based'}</span>
        </div>
      </div>

      {/* Price + change */}
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">₹{card.price.toLocaleString('en-IN')}</span>
        <span className={`text-sm font-semibold ${card.change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
          {card.change_pct >= 0 ? '+' : ''}{card.change_pct.toFixed(2)}%
        </span>
        <span className="ml-auto text-xs text-zinc-400">RSI {card.rsi.toFixed(0)}</span>
      </div>

      {/* AI confidence */}
      <div>
        <p className="mb-1 text-[10px] text-zinc-400">AI Confidence</p>
        <ConfBar v={card.ai_confidence} color={isBuy ? 'bg-emerald-500' : 'bg-red-400'} />
      </div>

      {/* Entry / Stop / Target / R:R */}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <div className="rounded-lg bg-white/60 px-2.5 py-1.5 dark:bg-zinc-900/60">
          <p className="text-zinc-400">Entry</p>
          <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{card.entry_price.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-white/60 px-2.5 py-1.5 dark:bg-zinc-900/60">
          <p className="text-zinc-400">Stop Loss</p>
          <p className="font-mono font-semibold text-red-600 dark:text-red-400">₹{card.stop_loss.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-white/60 px-2.5 py-1.5 dark:bg-zinc-900/60">
          <p className="text-zinc-400">Target</p>
          <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">₹{card.target.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-white/60 px-2.5 py-1.5 dark:bg-zinc-900/60">
          <p className="text-zinc-400">R:R</p>
          <p className={`font-mono font-semibold ${rrColor}`}>{card.risk_reward_ratio.toFixed(2)}</p>
        </div>
      </div>

      {/* Hold period */}
      <p className="text-xs text-zinc-400">Hold: <span className="text-zinc-600 dark:text-zinc-300">{card.holding_period}</span></p>

      {/* Sentiment tags */}
      <div className="flex flex-wrap gap-1">
        {card.sentiment_tags.map((tag, i) => (
          <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[tag.color] ?? TAG_COLORS.zinc}`}>
            {tag.label}
          </span>
        ))}
      </div>

      {/* Explanation */}
      <p className="text-xs italic text-zinc-500 dark:text-zinc-400">{card.explanation}</p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onWatch(card.symbol)}
          className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          + Watchlist
        </button>
        <Link
          href={`/paper?symbol=${encodeURIComponent(card.symbol)}&signal=${card.signal}`}
          className={`flex-1 rounded-lg py-1.5 text-center text-xs font-semibold text-white ${isBuy ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
        >
          Trade →
        </Link>
      </div>
    </div>
  )
}

export default function MarketPulseView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [result, setResult] = useState<MarketPulseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sector, setSector] = useState('all')
  const [elapsed, setElapsed] = useState(0)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
  }, [router])

  const runScan = useCallback(async (sec: string) => {
    setLoading(true); setError(null); setResult(null); setElapsed(0)
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    try {
      const data = await getMarketPulse(tokenRef.current, sec)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
      clearInterval(timer)
    }
  }, [])

  async function handleWatch(symbol: string) {
    try { await addToWatchlist(tokenRef.current, symbol) } catch { /* ignore duplicates */ }
  }

  function handleSector(s: string) {
    setSector(s)
    runScan(s)
  }

  if (!authChecked) return null

  const ov = result?.overview

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Market Pulse" />
      <main className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Market Pulse</h1>
            <p className="text-xs text-zinc-400">
              Full NSE/BSE scan · 200+ stocks across 12 sectors · AI-scored BUY & SELL picks
            </p>
          </div>
          <button
            onClick={() => runScan(sector)}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? `Scanning… ${elapsed}s` : result ? 'Refresh' : 'Scan Market'}
          </button>
        </div>

        {/* Sector filters */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SECTORS.map(s => (
            <button
              key={s}
              onClick={() => handleSector(s)}
              disabled={loading}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${sector === s ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-500 ring-1 ring-zinc-200 hover:ring-zinc-400 dark:bg-zinc-900 dark:ring-zinc-700'}`}
            >
              {s === 'all' ? 'All Sectors' : s}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Step 1: Fetching 1-year price history for 200+ stocks in parallel…<br />
            Step 2: Running AI analysis on top picks. This takes 60–90 seconds.
          </div>
        )}

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-80 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {!loading && !result && !error && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-20 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              Click <strong>Scan Market</strong> to analyse 200+ NSE/BSE stocks and surface today&apos;s top opportunities.
            </p>
            <p className="mt-1 text-xs text-zinc-400">Filter by sector · AI confidence scores · Entry, stop, target levels · Sentiment tags</p>
          </div>
        )}

        {!loading && result && (
          <>
            {/* Market Overview */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-400">Stocks Scanned</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{ov?.scanned}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Bullish</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{ov?.bullish} <span className="text-sm font-normal">({ov?.bullish_pct}%)</span></p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
                <p className="text-xs text-red-500 dark:text-red-400">Bearish</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-300">{ov?.bearish} <span className="text-sm font-normal">({ov?.bearish_pct}%)</span></p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-400">Neutral</p>
                <p className="text-2xl font-bold text-zinc-600 dark:text-zinc-300">{ov?.neutral}</p>
              </div>
            </div>

            {/* Sector Sentiment */}
            {ov?.sector_sentiment && Object.keys(ov.sector_sentiment).length > 0 && (
              <div className="mb-8 flex flex-wrap gap-2">
                {Object.entries(ov.sector_sentiment).map(([sec, sent]) => (
                  <span key={sec} className={`rounded-full px-3 py-1 text-xs font-medium ${SECTOR_COLOR[sent] ?? SECTOR_COLOR.neutral}`}>
                    {sec}: {sent}
                  </span>
                ))}
              </div>
            )}

            {/* Buy Picks */}
            {result.buy_picks.length > 0 && (
              <section className="mb-10">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">▲</span>
                  Top BUY Opportunities ({result.buy_picks.length})
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {result.buy_picks.map(c => (
                    <PulseCardView key={c.symbol} card={c} type="buy" onWatch={handleWatch} />
                  ))}
                </div>
              </section>
            )}

            {/* Sell Picks */}
            {result.sell_picks.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">▼</span>
                  Stocks to Avoid / SELL ({result.sell_picks.length})
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {result.sell_picks.map(c => (
                    <PulseCardView key={c.symbol} card={c} type="sell" onWatch={handleWatch} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

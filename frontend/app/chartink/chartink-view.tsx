'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { AddToWatchlistBtn } from '@/components/add-to-watchlist-btn'
import { getChartinkCandidates, getChartinkToday, listWatchlists } from '@/lib/api'
import type { ChartinkCandidate, Watchlist } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.7) return 'text-emerald-600 dark:text-emerald-400'
  if (confidence >= 0.45) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-500 dark:text-red-400'
}

function timeAgo(iso: string) {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({ candidates }: { candidates: ChartinkCandidate[] }) {
  if (!candidates.length) return null
  const scans = new Set(candidates.map(c => c.scan_name)).size
  const avgConfidence = candidates.reduce((s, c) => s + c.confidence, 0) / candidates.length
  const highConfidence = candidates.filter(c => c.confidence >= 0.7).length

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: 'Candidates', value: String(candidates.length), color: 'text-zinc-700 dark:text-zinc-200' },
        { label: 'Scans', value: String(scans), color: 'text-zinc-700 dark:text-zinc-200' },
        { label: 'Avg Confidence', value: `${Math.round(avgConfidence * 100)}%`, color: confidenceColor(avgConfidence) },
        { label: 'High Confidence (≥70%)', value: String(highConfidence), color: 'text-emerald-600 dark:text-emerald-400' },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Candidates table ─────────────────────────────────────────────────────────

function CandidatesTable({
  candidates, token, watchlists,
}: {
  candidates: ChartinkCandidate[]
  token: string
  watchlists: Watchlist[]
}) {
  if (!candidates.length) return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-2xl">📈</p>
      <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">No candidates yet</p>
      <p className="mt-1 text-xs text-zinc-400">
        Candidates appear here as soon as a Chartink scan alert hits the webhook
      </p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
            {['Received', 'Scan', 'Symbol', 'RSI / ADX / Vol', 'Confidence', 'Entry ₹', 'SL ₹', 'Target ₹', 'R:R', 'Hold', ''].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map(c => {
            const sym = c.symbol.replace(/\.(NS|BO)$/, '')
            return (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{timeAgo(c.received_at)}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                    {c.scan_name}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/forecast?symbol=${sym}`} className="font-bold text-zinc-800 hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-400">
                    {sym}
                  </Link>
                  <p className="text-[10px] text-zinc-400">trigger ₹{fmt(c.trigger_price)}</p>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {c.rsi.toFixed(0)} / {c.adx.toFixed(0)} / {c.volume_ratio.toFixed(1)}x
                </td>
                <td className="px-3 py-2">
                  <span className={`font-bold ${confidenceColor(c.confidence)}`}>{Math.round(c.confidence * 100)}%</span>
                </td>
                <td className="px-3 py-2 font-mono font-semibold text-zinc-800 dark:text-zinc-200">₹{fmt(c.entry_price)}</td>
                <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">₹{fmt(c.stop_loss)}</td>
                <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">₹{fmt(c.target)}</td>
                <td className="px-3 py-2 font-semibold text-indigo-600 dark:text-indigo-400">{c.risk_reward_ratio.toFixed(2)}x</td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{c.holding_period}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <AddToWatchlistBtn symbol={c.symbol} token={token} watchlists={watchlists} />
                    <Link
                      href={`/trade?symbol=${encodeURIComponent(c.symbol)}`}
                      className="whitespace-nowrap rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-amber-600"
                    >
                      Trade Now →
                    </Link>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChartinkView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [candidates, setCandidates] = useState<ChartinkCandidate[]>([])
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [scanFilter, setScanFilter] = useState('')
  const [todayOnly, setTodayOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (t: string, opts: { scanName: string; todayOnly: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const data = opts.todayOnly
        ? await getChartinkToday(t)
        : await getChartinkCandidates(t, opts.scanName || undefined, 100)
      setCandidates(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    listWatchlists(t).then(setWatchlists).catch(() => {})
    load(t, { scanName: scanFilter, todayOnly })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  function handleRefresh() {
    load(tokenRef.current, { scanName: scanFilter, todayOnly })
  }

  function handleTodayToggle() {
    const next = !todayOnly
    setTodayOnly(next)
    load(tokenRef.current, { scanName: scanFilter, todayOnly: next })
  }

  function handleScanFilterChange(value: string) {
    setScanFilter(value)
    if (!todayOnly) load(tokenRef.current, { scanName: value, todayOnly: false })
  }

  const scanNames = useMemo(
    () => Array.from(new Set(candidates.map(c => c.scan_name))).sort(),
    [candidates],
  )

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Chartink" />
      <div className="mx-auto max-w-6xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Chartink</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Candidates from Chartink scan-alert webhooks, scored on RSI / ADX / volume / MACD / trend ·
              Entry, Stop Loss &amp; Target auto-sized off ATR-14
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTodayToggle}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                todayOnly
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              Today only
            </button>
            {!todayOnly && scanNames.length > 0 && (
              <select
                value={scanFilter}
                onChange={e => handleScanFilterChange(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="">All scans</option>
                {scanNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? '⏳ Loading…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
            </div>
            <div className="h-64 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ) : (
          <div className="space-y-6">
            <SummaryStrip candidates={candidates} />
            <CandidatesTable candidates={candidates} token={tokenRef.current} watchlists={watchlists} />
          </div>
        )}
      </div>
    </div>
  )
}

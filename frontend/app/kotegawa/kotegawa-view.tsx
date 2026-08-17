'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { AddToWatchlistBtn } from '@/components/add-to-watchlist-btn'
import {
  getKotegawaLatest, getKotegawaHistory, getKotegawaByDate, triggerKotegawaScan,
  getKotegawaEarlyLatest, getKotegawaEarlyHistory, getKotegawaEarlyByDate, triggerKotegawaEarlyScan,
  getKotegawaIntradayLatest, getKotegawaIntradayHistory, getKotegawaIntradayByDate, triggerKotegawaIntradayScan,
  listWatchlists,
} from '@/lib/api'
import type { KotegawaPick, KotegawaScanResult, KotegawaHistoryItem, Watchlist } from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

// Reversal resolves target_hit/sl_hit/expired (multi-day BTST-style);
// Early Reversal/Intraday resolve WIN/LOSS/NEUTRAL (same-day, Golden-Egg-
// style -- see kotegawa_early_service.py). One lookup covers both
// vocabularies so PickCard doesn't need to know which tab it's in.
const OUTCOME_STYLE: Record<string, string> = {
  target_hit: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  WIN: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  sl_hit: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  LOSS: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  expired: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  NEUTRAL: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}
const OUTCOME_LABEL: Record<string, string> = {
  target_hit: 'Target Hit', WIN: 'Win',
  sl_hit: 'SL Hit', LOSS: 'Loss',
  expired: 'Expired', NEUTRAL: 'Neutral',
}

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] text-zinc-500">{value}/{max}</span>
    </div>
  )
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 70 ? '#059669' : score >= 55 ? '#f59e0b' : '#dc2626'
  const pct = Math.min(100, score)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="min-w-[2.5rem] text-right text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  )
}

function RankBadge({ rank, score }: { rank: number; score: number }) {
  const bg = score >= 70 ? 'bg-emerald-600' : score >= 55 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bg} text-xs font-bold text-white`}>
      {rank}
    </div>
  )
}

function Badge({ label, variant }: { label: string; variant: 'indigo' | 'emerald' | 'amber' | 'zinc' }) {
  const cls = {
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  }[variant]
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
  )
}

function PickCard({ pick, token, watchlists }: { pick: KotegawaPick; token: string; watchlists: Watchlist[] }) {
  const sym = pick.symbol.replace('.NS', '').replace('.BO', '')

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-start gap-3">
        <RankBadge rank={pick.rank} score={pick.confidence_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{sym}</span>
            <span className="text-xs font-semibold text-red-500">
              {pick.change_pct.toFixed(2)}%
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{pick.name} &middot; {pick.sector}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge label={`Capitulation ${pick.decline_1d_pct.toFixed(1)}%`} variant="indigo" />
            {pick.closed_upper_half && <Badge label="Closed off lows" variant="emerald" />}
            {pick.hammer_candle && <Badge label="Hammer candle" variant="emerald" />}
            {pick.rsi <= 35 && <Badge label={`RSI ${pick.rsi.toFixed(0)}`} variant="amber" />}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-zinc-400">LTP</p>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            &#8377;{fmt(pick.ltp ?? pick.current_price)}
          </p>
          {pick.pnl_amount != null && pick.pnl_pct != null && (
            <p className={`text-xs font-semibold ${pick.pnl_amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {pick.pnl_amount >= 0 ? '+' : ''}&#8377;{fmt(pick.pnl_amount)} ({pick.pnl_pct >= 0 ? '+' : ''}{pick.pnl_pct.toFixed(2)}%)
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Reversal Confidence Score</p>
        <ConfidenceBar score={pick.confidence_score} />
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Capitulation</span>
            <ScoreBar value={pick.capitulation_score} max={30} color="#4f46e5" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Volume Climax</span>
            <ScoreBar value={pick.volume_score} max={25} color="#0891b2" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Oversold (Kairi)</span>
            <ScoreBar value={pick.kairi_score} max={25} color="#d97706" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Reversal Signs</span>
            <ScoreBar value={pick.reversal_score} max={20} color="#059669" />
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
          <p className="text-[10px] text-zinc-400">Entry (Today)</p>
          <p className="font-bold text-zinc-900 dark:text-zinc-50">&#8377;{fmt(pick.entry_price)}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
          <p className="text-[10px] text-red-400">Stop Loss</p>
          <p className="font-bold text-red-600">&#8377;{fmt(pick.stop_loss)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target 1 (Bounce)</p>
          <p className="font-bold text-emerald-600">&#8377;{fmt(pick.target_1)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
          <p className="text-[10px] text-emerald-400">Target 2</p>
          <p className="font-bold text-emerald-600">&#8377;{fmt(pick.target_2)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
          R:R {pick.risk_reward}x
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          RSI {pick.rsi.toFixed(0)}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Vol {pick.volume_ratio.toFixed(1)}x
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {Math.abs(pick.kairi_pct).toFixed(1)}% below SMA25
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          ₹{pick.avg_daily_value_cr.toFixed(1)}cr/day liquidity
        </span>
      </div>

      {pick.reasons.length > 0 && (
        <ul className="mb-4 space-y-0.5">
          {pick.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <span className="mt-0.5 text-indigo-500">&#9679;</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      {pick.outcome && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${
          OUTCOME_STYLE[pick.outcome] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
        }`}>
          Outcome: {OUTCOME_LABEL[pick.outcome] ?? pick.outcome}
          {pick.actual_pct != null && (
            <span className="ml-2">
              ({pick.actual_pct >= 0 ? '+' : ''}{pick.actual_pct.toFixed(2)}%)
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <AddToWatchlistBtn symbol={pick.symbol} token={token} watchlists={watchlists} />
        <Link
          href={`/trade?symbol=${encodeURIComponent(pick.symbol)}`}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Trade Now →
        </Link>
      </div>
    </div>
  )
}

function ScanOverview({ scan }: { scan: KotegawaScanResult }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: 'Universe', value: scan.universe_scanned, color: 'text-indigo-600' },
        { label: 'Candidates Screened', value: scan.passed_filter, color: 'text-amber-600' },
        { label: 'Picks', value: scan.picks.length, color: 'text-emerald-600' },
        { label: 'Nifty Today', value: `${scan.nifty_change_pct >= 0 ? '+' : ''}${scan.nifty_change_pct.toFixed(2)}%`, color: 'text-zinc-600', isText: true },
      ].map(({ label, value, color, isText }) => (
        <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${color} dark:opacity-90 ${isText ? 'text-sm' : ''}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

const HISTORY_RANGES: { label: string; limit: number }[] = [
  { label: '1D', limit: 1 },
  { label: '1W', limit: 7 },
  { label: '1M', limit: 30 },
  { label: '3M', limit: 90 },
]

function HistoryTable({
  history, selectedDate, onSelect,
}: {
  history: KotegawaHistoryItem[]
  selectedDate: string | null
  onSelect: (date: string) => void
}) {
  if (history.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            {['Date', 'Scan Time', 'Universe', 'Screened', 'Picks', 'Top Pick', 'Score', 'LTP', 'P&L'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map(row => (
            <tr
              key={row.id}
              onClick={() => onSelect(row.scan_date)}
              className={`cursor-pointer border-b border-zinc-100 hover:bg-indigo-50/60 dark:border-zinc-800 dark:hover:bg-indigo-950/30 ${
                selectedDate === row.scan_date ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''
              }`}
            >
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{row.scan_date}</td>
              <td className="px-4 py-3 text-zinc-500">{fmtTime(row.scan_time)}</td>
              <td className="px-4 py-3 text-zinc-500">{row.universe_scanned}</td>
              <td className="px-4 py-3 text-zinc-500">{row.passed_filter}</td>
              <td className="px-4 py-3 font-semibold text-emerald-600">{row.pick_count}</td>
              <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                {row.top_symbol.replace('.NS', '').replace('.BO', '')}
              </td>
              <td className="px-4 py-3">
                <span className={`font-bold ${
                  row.top_score >= 70 ? 'text-emerald-600' : row.top_score >= 55 ? 'text-amber-500' : 'text-red-500'
                }`}>{row.top_score}</span>
              </td>
              <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                {row.top_ltp != null ? `₹${fmt(row.top_ltp)}` : '—'}
              </td>
              <td className="px-4 py-3">
                {row.top_pnl_amount != null && row.top_pnl_pct != null ? (
                  <span className={`font-semibold ${row.top_pnl_amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {row.top_pnl_amount >= 0 ? '+' : ''}₹{fmt(row.top_pnl_amount)} ({row.top_pnl_pct >= 0 ? '+' : ''}{row.top_pnl_pct.toFixed(2)}%)
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({
  onScan, scanning, title, subtitle,
}: {
  onScan: () => void
  scanning: boolean
  title: string
  subtitle: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 py-20 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 text-5xl">&#128201;</div>
      <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
      <p className="mb-6 text-sm text-zinc-500">{subtitle}</p>
      <button
        onClick={onScan}
        disabled={scanning}
        className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {scanning ? 'Scanning...' : 'Run Scan Now'}
      </button>
    </div>
  )
}

// ── Shared panel — renders one strategy's scan/picks/history, parameterized
// by which API endpoints and copy strings to use. All three Kotegawa tabs
// share this identical shape (same KotegawaPick/KotegawaScanResult data
// coming off the backend's shared scoring engine, see
// kotegawa_scanner.run_kotegawa_scan) -- only the data source, framing
// copy, and outcome vocabulary differ. ──────────────────────────────────

type KotegawaApi = {
  getLatest: (token: string) => Promise<KotegawaScanResult>
  getHistory: (token: string, limit?: number) => Promise<KotegawaHistoryItem[]>
  getByDate: (token: string, date: string) => Promise<KotegawaScanResult>
  triggerScan: (token: string) => Promise<KotegawaScanResult>
}

function KotegawaStrategyPanel({
  api, cacheKey, title, subtitle, infoBox, emptyTitle, emptySubtitle, noPicksMessage, picksHeading,
}: {
  api: KotegawaApi
  cacheKey: string
  title: string
  subtitle: string
  infoBox: React.ReactNode
  emptyTitle: string
  emptySubtitle: string
  noPicksMessage: string
  picksHeading: string
}) {
  const [scan, setScan] = useState<KotegawaScanResult | null>(null)
  const [history, setHistory] = useState<KotegawaHistoryItem[]>([])
  const [historyLimit, setHistoryLimit] = useState(30)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [userRole, setUserRole] = useState<string>('')
  const [viewedDate, setViewedDate] = useState<string | null>(null)
  const [viewedScan, setViewedScan] = useState<KotegawaScanResult | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const tokenRef = useRef('')

  async function load() {
    const token = tokenRef.current
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [latestResult, histResult, wlResult] = await Promise.allSettled([
        api.getLatest(token),
        api.getHistory(token, historyLimit),
        listWatchlists(token),
      ])
      if (latestResult.status === 'fulfilled') { setScan(latestResult.value); writePageCache(cacheKey, latestResult.value) }
      if (histResult.status === 'fulfilled') setHistory(histResult.value)
      if (wlResult.status === 'fulfilled') setWatchlists(wlResult.value)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory(limit: number) {
    const token = tokenRef.current
    if (!token) return
    try {
      setHistory(await api.getHistory(token, limit))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSelectDate(date: string) {
    const token = tokenRef.current
    if (!token) return
    if (viewedDate === date) {
      setViewedDate(null)
      setViewedScan(null)
      return
    }
    setViewedDate(date)
    setViewLoading(true)
    setError(null)
    try {
      setViewedScan(await api.getByDate(token, date))
    } catch (e) {
      setError((e as Error).message)
      setViewedDate(null)
    } finally {
      setViewLoading(false)
    }
  }

  function backToLatest() {
    setViewedDate(null)
    setViewedScan(null)
  }

  async function handleScan() {
    const token = tokenRef.current
    if (!token) return
    setScanning(true)
    setError(null)
    try {
      const result = await api.triggerScan(token)
      setScan(result)
      backToLatest()
      await loadHistory(historyLimit)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('mts_token') ?? ''
    tokenRef.current = token
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1])) : {}
      setUserRole(payload.role ?? '')
    } catch {
      setUserRole('')
    }
    const cached = readPageCache<KotegawaScanResult>(cacheKey)
    if (cached) Promise.resolve().then(() => { setScan(cached); setLoading(false) })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAdmin = userRole === 'admin'
  const displayScan = viewedScan ?? scan

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{title}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        {isAdmin && (
          <button
            onClick={handleScan}
            disabled={scanning || loading}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Run Scan Now'}
          </button>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
        {infoBox}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-72 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        </div>
      ) : scan === null ? (
        <EmptyState onScan={handleScan} scanning={scanning} title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        <div className="space-y-6">
          {viewedDate && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
              <span className="font-medium text-indigo-700 dark:text-indigo-300">
                Viewing historical scan &middot; {viewedDate}
              </span>
              <button
                onClick={backToLatest}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-zinc-800"
              >
                &larr; Back to Latest
              </button>
            </div>
          )}

          {viewLoading || !displayScan ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-72 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
              ))}
            </div>
          ) : (
            <>
              <ScanOverview scan={displayScan} />

              {displayScan.picks.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-800 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{noPicksMessage}</p>
                  {isAdmin && !viewedDate && (
                    <button
                      onClick={handleScan}
                      disabled={scanning}
                      className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Run Another Scan
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {picksHeading} &nbsp;
                    <span className="font-normal text-zinc-400">&middot; {displayScan.scan_date}</span>
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {displayScan.picks.map(pick => (
                      <PickCard
                        key={pick.symbol}
                        pick={pick}
                        token={tokenRef.current}
                        watchlists={watchlists}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {history.length > 0 && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Scan History &nbsp;
                  <span className="font-normal text-zinc-400">&middot; click a row to view that day&apos;s picks</span>
                </h2>
                <div className="flex gap-1">
                  {HISTORY_RANGES.map(r => (
                    <button
                      key={r.label}
                      onClick={() => { setHistoryLimit(r.limit); loadHistory(r.limit) }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        historyLimit === r.limit
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <HistoryTable history={history} selectedDate={viewedDate} onSelect={handleSelectDate} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page — tab switcher over the three Kotegawa strategies ──────────────

type KotegawaTab = 'reversal' | 'early' | 'intraday'

const TABS: { id: KotegawaTab; label: string }[] = [
  { id: 'reversal', label: 'Reversal (BTST)' },
  { id: 'early', label: 'Early Reversal (Intraday Entry)' },
  { id: 'intraday', label: 'Intraday (NIFTY 100)' },
]

export function KotegawaView() {
  const [tab, setTab] = useState<KotegawaTab>('reversal')

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Kotegawa Reversal" />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'reversal' && (
          <KotegawaStrategyPanel
            api={{
              getLatest: getKotegawaLatest,
              getHistory: getKotegawaHistory,
              getByDate: getKotegawaByDate,
              triggerScan: triggerKotegawaScan,
            }}
            cacheKey="kotegawa:scan"
            title="Kotegawa Reversal — Capitulation Bounce"
            subtitle="Mean reversion, BNF-style · Scans NIFTY 500 · Updated daily at 2:15 PM IST"
            infoBox={
              <>
                Modeled on Takashi Kotegawa (&quot;BNF&quot;)&apos;s mean-reversion style: buy a liquid stock after
                a sharp, high-volume single-day capitulation decline once price has stretched far below its
                25-day average, betting on a snap-back bounce — the opposite of a breakout strategy. Enters at
                today&apos;s close, held BTST-style over the following days until target/stop resolves.
                Capitulation events are rare by design, so it&apos;s normal for a scan to find zero picks on a
                calm trading day. This does not replicate real-time order-book reading or any fundamental
                judgment about whether a crash is justified — only the quantifiable decline/volume/deviation
                pattern from daily price data.
              </>
            }
            emptyTitle="No Kotegawa scan yet"
            emptySubtitle="Run a scan to find today's capitulation bounce candidates."
            noPicksMessage="Scan ran but no stocks passed the capitulation hard filters (≥4% single-day or ≥7% 3-day decline, ≥2x volume climax, ≥10% below 25-day SMA, min liquidity, score ≥ 55). This is expected on calmer trading days — capitulation events are rare."
            picksHeading="Top Reversal Picks"
          />
        )}

        {tab === 'early' && (
          <KotegawaStrategyPanel
            api={{
              getLatest: getKotegawaEarlyLatest,
              getHistory: getKotegawaEarlyHistory,
              getByDate: getKotegawaEarlyByDate,
              triggerScan: triggerKotegawaEarlyScan,
            }}
            cacheKey="kotegawa-early:scan"
            title="Kotegawa Early Reversal — Intraday Entry"
            subtitle="Same rule set as Reversal, scanned live · Re-scans every 15 min, 9:30 AM–2:45 PM IST"
            infoBox={
              <>
                Same capitulation/kairi/volume/reversal rule set as Kotegawa Reversal, but scanned repeatedly
                through the trading session instead of once at the close — so a candidate can be caught and
                entered <strong>intraday</strong>, same-day. Open picks are checked against their own
                target/stop every 5 minutes and force-closed at 3:35 PM IST if still open — same-day only,
                no overnight hold. A stock already tracked with an open pick today won&apos;t be flagged
                again until it resolves.
              </>
            }
            emptyTitle="No Kotegawa Early Reversal scan yet"
            emptySubtitle="Run a scan to find live capitulation bounce candidates."
            noPicksMessage="Scan ran but no stocks passed the capitulation hard filters (≥4% single-day or ≥7% 3-day decline, ≥2x volume climax, ≥10% below 25-day SMA, min liquidity, score ≥ 55). This is expected on calmer trading days — capitulation events are rare, and this checks the same bar as Reversal, just more often."
            picksHeading="Today's Intraday Entry Picks"
          />
        )}

        {tab === 'intraday' && (
          <KotegawaStrategyPanel
            api={{
              getLatest: getKotegawaIntradayLatest,
              getHistory: getKotegawaIntradayHistory,
              getByDate: getKotegawaIntradayByDate,
              triggerScan: triggerKotegawaIntradayScan,
            }}
            cacheKey="kotegawa-intraday:scan"
            title="Kotegawa Intraday — NIFTY 100"
            subtitle="Same rule set, curated liquid universe · Scans NIFTY 100 · Re-scans every 15 min, 9:30 AM–2:45 PM IST"
            infoBox={
              <>
                Same rule set as Early Reversal, restricted to NIFTY 100&apos;s ~100 most liquid, index-selected
                large caps at a stricter score gate (≥65 vs 55) — a smaller, higher-quality candidate pool for
                same-day-only entries. Open picks are checked against their own target/stop every 5 minutes and
                force-closed at 3:35 PM IST if still open.
              </>
            }
            emptyTitle="No Kotegawa Intraday scan yet"
            emptySubtitle="Run a scan to find live capitulation bounce candidates within NIFTY 100."
            noPicksMessage="Scan ran but no NIFTY 100 stocks passed the stricter capitulation filters (≥4% single-day or ≥7% 3-day decline, ≥2x volume climax, ≥10% below 25-day SMA, min liquidity, score ≥ 65). This is expected on calmer trading days, and more likely here than on the full-universe scans given the smaller pool and higher bar."
            picksHeading="Today's Intraday Picks"
          />
        )}
      </div>
    </div>
  )
}

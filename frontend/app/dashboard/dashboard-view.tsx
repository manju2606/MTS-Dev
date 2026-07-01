'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import {
  getMe, getTopPicks, getDiscoveryStatus, listTrades, listAlerts, getQuote, getMarketOverview,
  getSotDToday,
} from '@/lib/api'
import type {
  User, StockScore, DiscoveryStatus, Trade, AlertRule,
  IndexQuote, EconomicEvent, MarketOverviewData, StockOfDay,
} from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number, sym?: string) {
  if (sym === 'USDINR=X' || sym === 'GC=F' || sym === 'CL=F') {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function chgColor(pct: number) {
  return pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
}

// ── Signal config ─────────────────────────────────────────────────────────────

const SIGNAL_RANK: Record<string, number> = {
  STRONG_BUY: 6, BUY: 5, WATCH: 4, NEUTRAL: 3, SELL: 2, STRONG_SELL: 1,
}
const SIGNAL_STYLE: Record<string, string> = {
  STRONG_BUY:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
  BUY:         'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
  WATCH:       'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  NEUTRAL:     'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  SELL:        'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400',
  STRONG_SELL: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300',
}

type SortKey = 'signal' | 'score' | 'entry_price' | 'risk_reward_ratio'
type SortDir = 'asc' | 'desc'

function sortPicks(arr: StockScore[], key: SortKey, dir: SortDir): StockScore[] {
  return [...arr].sort((a, b) => {
    const av = key === 'signal' ? (SIGNAL_RANK[a.signal] ?? 0) : (a[key] as number)
    const bv = key === 'signal' ? (SIGNAL_RANK[b.signal] ?? 0) : (b[key] as number)
    return dir === 'desc' ? bv - av : av - bv
  })
}

// ── Index ticker strip ────────────────────────────────────────────────────────

function IndexStrip({ indices }: { indices: IndexQuote[] }) {
  if (!indices.length) return null
  const vix = indices.find(i => i.symbol === '^INDIAVIX')
  const others = indices.filter(i => i.symbol !== '^INDIAVIX')

  function vixLabel(price: number) {
    if (price < 13) return { label: 'Low Fear', color: 'text-emerald-600 dark:text-emerald-400' }
    if (price < 20) return { label: 'Calm', color: 'text-emerald-500 dark:text-emerald-300' }
    if (price < 25) return { label: 'Moderate', color: 'text-amber-600 dark:text-amber-400' }
    if (price < 30) return { label: 'Elevated', color: 'text-orange-600 dark:text-orange-400' }
    return { label: 'High Fear', color: 'text-red-600 dark:text-red-400' }
  }

  return (
    <div className="mb-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-max divide-x divide-zinc-100 dark:divide-zinc-800">
        {others.map(idx => (
          <div key={idx.symbol} className="flex-1 min-w-[160px] px-5 py-3">
            <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{idx.name}</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
              {fmtPrice(idx.price)}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-xs font-semibold ${chgColor(idx.change_pct)}`}>
                {idx.change_pct >= 0 ? '▲' : '▼'} {Math.abs(idx.change_pct).toFixed(2)}%
              </span>
              <span className={`text-[10px] ${chgColor(idx.change)}`}>
                ({idx.change >= 0 ? '+' : ''}{fmtPrice(idx.change)})
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-400">H: {fmtPrice(idx.high)} · L: {fmtPrice(idx.low)}</p>
          </div>
        ))}
        {vix && (
          <div className="flex-1 min-w-[140px] px-5 py-3">
            <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">India VIX</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
              {vix.price.toFixed(2)}
            </p>
            <span className={`text-xs font-semibold ${vixLabel(vix.price).color}`}>
              {vixLabel(vix.price).label}
            </span>
            <p className={`mt-0.5 text-[10px] ${chgColor(vix.change_pct)}`}>
              {vix.change_pct >= 0 ? '▲' : '▼'} {Math.abs(vix.change_pct).toFixed(2)}%
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Market sentiment (computed from picks) ────────────────────────────────────

function SentimentCard({ picks, status }: { picks: StockScore[] | null; status: DiscoveryStatus | null }) {
  const counts = picks
    ? {
        bullish: picks.filter(p => ['STRONG_BUY', 'BUY'].includes(p.signal)).length,
        watch:   picks.filter(p => p.signal === 'WATCH').length,
        bearish: picks.filter(p => ['SELL', 'STRONG_SELL'].includes(p.signal)).length,
        total:   picks.length,
      }
    : { bullish: 0, watch: 0, bearish: 0, total: 0 }

  const { bullish, watch, bearish, total } = counts
  const bullPct  = total ? Math.round(bullish / total * 100) : 0
  const bearPct  = total ? Math.round(bearish / total * 100) : 0

  let label = 'Neutral', labelColor = 'text-zinc-500', bgColor = 'bg-zinc-100 dark:bg-zinc-800'
  if (bullPct >= 55) { label = 'Bullish'; labelColor = 'text-emerald-600'; bgColor = 'bg-emerald-50 dark:bg-emerald-950/40' }
  else if (bullPct >= 45) { label = 'Cautiously Bullish'; labelColor = 'text-emerald-500'; bgColor = 'bg-emerald-50/50 dark:bg-emerald-950/20' }
  else if (bearPct >= 55) { label = 'Bearish'; labelColor = 'text-red-600'; bgColor = 'bg-red-50 dark:bg-red-950/40' }
  else if (bearPct >= 40) { label = 'Cautious'; labelColor = 'text-amber-600'; bgColor = 'bg-amber-50 dark:bg-amber-950/30' }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">Market Sentiment</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${bgColor} ${labelColor}`}>{label}</span>
      </div>

      {/* Breadth bar */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full">
            <div className="bg-emerald-500" style={{ width: `${bullPct}%` }} />
            <div className="bg-amber-400" style={{ width: `${total ? Math.round(watch / total * 100) : 0}%` }} />
            <div className="bg-red-400 flex-1" />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-zinc-400">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{bullish} Bull ({bullPct}%)</span>
            <span className="text-amber-600 dark:text-amber-400">{watch} Watch</span>
            <span className="text-red-500 dark:text-red-400 font-semibold">{bearish} Bear ({bearPct}%)</span>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Stocks scanned</span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{status?.stocks_scanned ?? total}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Universe</span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{status?.universe_size ?? '—'} stocks</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Last scan</span>
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {status?.last_scan_at
              ? new Date(status.last_scan_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST'
              : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Global markets ────────────────────────────────────────────────────────────

function GlobalMarketsCard({ global: markets }: { global: IndexQuote[] }) {
  if (!markets.length) return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Global Markets</p>
      <p className="text-xs text-zinc-400 py-4 text-center">Loading…</p>
    </div>
  )
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400 mb-3">Global Markets</p>
      <div className="space-y-2">
        {markets.map(m => (
          <div key={m.symbol} className="flex items-center justify-between">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate w-28">{m.name}</p>
            <div className="text-right">
              <p className="text-xs font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                {m.symbol === 'USDINR=X' ? `₹${m.price.toFixed(2)}` : m.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
              <p className={`text-[10px] font-semibold ${chgColor(m.change_pct)}`}>
                {m.change_pct >= 0 ? '▲' : '▼'} {Math.abs(m.change_pct).toFixed(2)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sector heat map ───────────────────────────────────────────────────────────

function SectorHeatMap({ picks }: { picks: StockScore[] | null }) {
  if (!picks || picks.length === 0) return null

  const sectorMap: Record<string, { score: number; count: number; bullish: number }> = {}
  for (const p of picks) {
    const sec = p.sector || 'Other'
    if (!sectorMap[sec]) sectorMap[sec] = { score: 0, count: 0, bullish: 0 }
    sectorMap[sec].score += p.score
    sectorMap[sec].count += 1
    if (['STRONG_BUY', 'BUY'].includes(p.signal)) sectorMap[sec].bullish += 1
  }

  const sectors = Object.entries(sectorMap)
    .map(([name, d]) => ({
      name,
      avg: Math.round(d.score / d.count),
      count: d.count,
      bullPct: Math.round(d.bullish / d.count * 100),
    }))
    .sort((a, b) => b.avg - a.avg)

  function tileColor(avg: number) {
    if (avg >= 80) return 'bg-emerald-600 text-white'
    if (avg >= 65) return 'bg-emerald-400 text-white'
    if (avg >= 55) return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-200'
    if (avg >= 45) return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
    if (avg >= 35) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    return 'bg-red-300 text-red-900 dark:bg-red-700 dark:text-red-100'
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">Sector Heat Map</p>
        <Link href="/heatmap" className="text-[10px] text-indigo-500 hover:text-indigo-700">Full map →</Link>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {sectors.map(s => (
          <div key={s.name} title={`${s.name}: score ${s.avg}, ${s.count} stocks, ${s.bullPct}% bullish`}
            className={`rounded-lg p-2 text-center cursor-default transition-opacity hover:opacity-90 ${tileColor(s.avg)}`}>
            <p className="text-[10px] font-semibold leading-tight truncate">{s.name}</p>
            <p className="text-sm font-bold mt-0.5">{s.avg}</p>
            <p className="text-[9px] opacity-80">{s.count} stocks</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 justify-center">
        {[
          ['bg-emerald-600', '80+'],
          ['bg-emerald-400', '65–80'],
          ['bg-emerald-200 dark:bg-emerald-800', '55–65'],
          ['bg-zinc-200 dark:bg-zinc-600', '45–55'],
          ['bg-red-200 dark:bg-red-800', '35–45'],
          ['bg-red-400', '<35'],
        ].map(([cls, label]) => (
          <div key={label} className="flex items-center gap-0.5">
            <div className={`h-2 w-2 rounded-sm ${cls}`} />
            <span className="text-[9px] text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Economic events ───────────────────────────────────────────────────────────

function daysUntil(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return `${diff}d`
  if (diff < 30) return `${Math.ceil(diff / 7)}w`
  return `${Math.ceil(diff / 30)}mo`
}

function EconomicEventsCard({ events }: { events: EconomicEvent[] }) {
  const catStyle: Record<string, string> = {
    rbi:     'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300',
    market:  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    results: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    budget:  'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  }
  const catLabel: Record<string, string> = {
    rbi: 'RBI', market: 'F&O', results: 'Earnings', budget: 'Budget',
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400 mb-3">
        Economic Events
      </p>
      {events.length === 0 ? (
        <p className="py-4 text-xs text-center text-zinc-400">No upcoming events loaded.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${catStyle[e.category] ?? ''}`}>
                  {catLabel[e.category] ?? e.category}
                </span>
                <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{e.event}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-zinc-400">{new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                <p className="text-[10px] font-semibold text-indigo-500">{daysUntil(e.date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
    </div>
  )
}

// ── Open positions mini table ─────────────────────────────────────────────────

function OpenPositions({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return (
    <p className="py-4 text-center text-sm text-zinc-400">No open paper positions.</p>
  )
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          {['Symbol', 'Signal', 'Entry', 'Stop', 'Target', 'Qty'].map(h => (
            <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map(t => (
          <tr key={t.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
            <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{t.symbol.replace(/\.(NS|BO)$/, '')}</td>
            <td className="px-3 py-2">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${t.signal === 'BUY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
                {t.signal}
              </span>
            </td>
            <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">₹{t.entry_price.toFixed(2)}</td>
            <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">₹{t.stop_loss.toFixed(2)}</td>
            <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">₹{t.target.toFixed(2)}</td>
            <td className="px-3 py-2 text-zinc-500">{t.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────────

function SortTh({ label, k, sortKey, sortDir, onSort }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  return (
    <th
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none px-3 py-2.5 text-left text-xs font-medium hover:text-zinc-700 dark:hover:text-zinc-200 ${
        sortKey === k ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
      }`}
    >
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
    </th>
  )
}

// ── Stock of the Day compact card ─────────────────────────────────────────────

function SotDDashCard({ sotd }: { sotd: StockOfDay | null }) {
  if (!sotd) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <span className="text-base">⭐</span>
          <div>
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Stock of the Day</p>
            <p className="text-[10px] text-zinc-400">Auto-generates at 09:30 IST on trading days</p>
          </div>
        </div>
        <Link href="/stock-of-day" className="text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          View →
        </Link>
      </div>
    )
  }

  const sym = sotd.symbol.replace(/\.(NS|BO)$/, '')
  const pnl = sotd.pnl_pct
  const pnlColor = pnl == null ? '' : pnl >= 0 ? 'text-emerald-600' : 'text-red-500'
  const statusColor: Record<string, string> = {
    WATCHING: 'text-amber-600', TRADING: 'text-blue-600 animate-pulse',
    TARGET_HIT: 'text-emerald-600', STOP_HIT: 'text-red-600', EXPIRED: 'text-zinc-500',
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-violet-950/20">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-base">⭐</span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-400">Stock of the Day</p>
          <p className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">{sym}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <div><p className="text-[9px] text-zinc-400">Entry</p><p className="font-mono font-semibold">₹{sotd.entry_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p></div>
        <div><p className="text-[9px] text-zinc-400">SL</p><p className="font-mono font-semibold text-red-600 dark:text-red-400">₹{sotd.stop_loss.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p></div>
        <div><p className="text-[9px] text-zinc-400">Target</p><p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">₹{sotd.target.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p></div>
        <div><p className="text-[9px] text-zinc-400">Confidence Score</p><p className="font-bold text-indigo-600">{Math.round(sotd.composite_score)}</p></div>
        <div><p className="text-[9px] text-zinc-400">Status</p><p className={`font-bold text-[10px] ${statusColor[sotd.status] ?? ''}`}>{sotd.status.replace('_', ' ')}</p></div>
        {pnl != null && (
          <div><p className="text-[9px] text-zinc-400">P&L</p><p className={`font-bold font-mono ${pnlColor}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</p></div>
        )}
      </div>
      <Link href="/stock-of-day" className="ml-auto shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-700">
        Details →
      </Link>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function DashboardView() {
  const router = useRouter()
  const tokenRef = useRef('')

  const [user, setUser]         = useState<User | null>(null)
  const [picks, setPicks]       = useState<StockScore[] | null>(null)
  const [status, setStatus]     = useState<DiscoveryStatus | null>(null)
  const [trades, setTrades]     = useState<Trade[]>([])
  const [alerts, setAlerts]     = useState<AlertRule[]>([])
  const [market, setMarket]     = useState<MarketOverviewData | null>(null)
  const [sotd, setSotd]         = useState<StockOfDay | null>(null)
  const [sortKey, setSortKey]   = useState<SortKey>('signal')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [sigFilter, setSigFilter] = useState<string>('All')
  const [ltps, setLtps]         = useState<Record<string, number>>({})

  const CACHE_KEY = 'mts_dashboard_cache'

  const applyCache = useCallback((raw: string) => {
    try {
      const c = JSON.parse(raw)
      if (c.picks)  setPicks(c.picks)
      if (c.status) setStatus(c.status)
      if (c.market) setMarket(c.market)
      if (c.sotd !== undefined) setSotd(c.sotd)
      if (c.trades) setTrades(c.trades)
      if (c.alerts) setAlerts(c.alerts)
    } catch { /* ignore corrupt cache */ }
  }, [])

  const load = useCallback(async (token: string) => {
    const [me, p, s, t, a, mkt, sotdRes] = await Promise.all([
      getMe(token),
      getTopPicks(token, 50, undefined, 0),
      getDiscoveryStatus(token),
      listTrades(token, 'open').catch(() => [] as Trade[]),
      listAlerts(token).catch(() => [] as AlertRule[]),
      getMarketOverview(token).catch(() => null),
      getSotDToday(token).catch(() => null),
    ])
    const openTrades = (t as Trade[]).filter((tr: Trade) => tr.status === 'open')
    const activeAlerts = (a as AlertRule[]).filter((al: AlertRule) => !al.triggered)
    setUser(me)
    setPicks(p)
    setStatus(s)
    setTrades(openTrades)
    setAlerts(activeAlerts)
    if (mkt) setMarket(mkt)
    if (sotdRes !== null) setSotd(sotdRes?.data ?? null)

    // Persist fresh data to cache
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        picks: p,
        status: s,
        market: mkt,
        sotd: sotdRes?.data ?? null,
        trades: openTrades,
        alerts: activeAlerts,
      }))
    } catch { /* storage full — ignore */ }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t

    // Show cached data immediately (no blank screen)
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) applyCache(cached)

    const run = async () => { try { await load(t) } catch { router.replace('/login') } }
    void run()

    // Auto-refresh every 5 seconds
    const id = setInterval(() => { void load(t) }, 5000)
    return () => clearInterval(id)
  }, [router, load, applyCache])

  useEffect(() => {
    if (!picks || picks.length === 0) return
    const token = tokenRef.current
    const prices: Record<string, number> = {}
    Promise.allSettled(picks.map(async r => {
      try { const q = await getQuote(token, r.symbol); prices[r.symbol] = q.price } catch { /* skip */ }
    })).then(() => setLtps({ ...prices }))
  }, [picks])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SIGS = ['All', 'STRONG_BUY', 'BUY', 'WATCH', 'NEUTRAL', 'SELL', 'STRONG_SELL']

  const displayed = picks
    ? sortPicks(
        sigFilter === 'All' ? picks : picks.filter(p => p.signal === sigFilter),
        sortKey, sortDir
      ).slice(0, 15)
    : null

  const sigCounts = picks
    ? Object.fromEntries(
        ['STRONG_BUY', 'BUY', 'WATCH'].map(s => [s, picks.filter(p => p.signal === s).length])
      )
    : {}

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Dashboard" />
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* Greeting */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {user ? `Welcome back, ${user.full_name.split(' ')[0]}` : 'Dashboard'}
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
            </p>
          </div>
          <Link href="/discovery"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            Full Discovery →
          </Link>
        </div>

        {/* Index ticker strip */}
        <IndexStrip indices={market?.indices ?? []} />

        {/* Stats row */}
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="AI Picks Today" value={picks?.length ?? '—'}
            sub={`${sigCounts['STRONG_BUY'] ?? 0} strong buy · ${sigCounts['BUY'] ?? 0} buy`}
            accent="text-indigo-600 dark:text-indigo-400" />
          <StatCard label="Open Positions" value={trades.length}
            sub="paper trades"
            accent={trades.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : undefined} />
          <StatCard label="Active Alerts" value={alerts.length}
            sub="price alerts"
            accent={alerts.length > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />
          <StatCard label="Universe" value={status?.universe_size ?? '—'}
            sub="NSE/BSE stocks scanned" />
        </div>

        {/* Stock of the Day banner */}
        <div className="mb-5">
          <SotDDashCard sotd={sotd} />
        </div>

        {/* Market context row: Sentiment | Global | Economic Events */}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SentimentCard picks={picks} status={status} />
          <GlobalMarketsCard global={market?.global ?? []} />
          <EconomicEventsCard events={market?.economic_events ?? []} />
        </div>

        {/* Main 3-col grid */}
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Left — AI Picks (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Today&apos;s AI Picks
                    {picks !== null && <span className="ml-2 text-xs font-normal text-zinc-400">top 15 shown</span>}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SIGS.map(s => (
                    <button key={s} onClick={() => setSigFilter(s)}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                        sigFilter === s
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {s === 'All' ? `All (${picks?.length ?? 0})` : s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {displayed === null ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                  ))}
                </div>
              ) : displayed.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-400">
                  No picks yet — run a scan from the Discovery page.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">#</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Symbol</th>
                        <SortTh label="Signal" k="signal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortTh label="Confidence Score" k="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortTh label="Entry" k="entry_price" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-500 dark:text-indigo-400">LTP</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Stop</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-emerald-600 dark:text-emerald-400">T1</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-emerald-700 dark:text-emerald-500">T2</th>
                        <SortTh label="R:R" k="risk_reward_ratio" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Hold</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {displayed.map((s, i) => {
                        const t1 = s.targets[0], t2 = s.targets[1]
                        const t1pct = t1 ? `+${(((t1 - s.entry_price) / s.entry_price) * 100).toFixed(1)}%` : ''
                        const t2pct = t2 ? `+${(((t2 - s.entry_price) / s.entry_price) * 100).toFixed(1)}%` : ''
                        return (
                          <tr key={s.id} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-zinc-50/30 dark:bg-zinc-800/10' : ''}`}>
                            <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-xs">{s.symbol.replace(/\.(NS|BO)$/, '')}</p>
                              <p className="text-[10px] text-zinc-400">{s.name}</p>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLE[s.signal] ?? ''}`}>
                                {s.signal.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                  <div className={`h-full rounded-full ${s.score >= 70 ? 'bg-emerald-500' : s.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${s.score}%` }} />
                                </div>
                                <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">{s.score.toFixed(0)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">₹{s.entry_price.toFixed(2)}</td>
                            <td className="px-3 py-2 text-xs">
                              {ltps[s.symbol] ? (
                                <>
                                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{ltps[s.symbol].toFixed(2)}</span>
                                  <span className={`ml-1 text-[10px] font-medium ${ltps[s.symbol] >= s.entry_price ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                    {ltps[s.symbol] >= s.entry_price ? '+' : ''}{(((ltps[s.symbol] - s.entry_price) / s.entry_price) * 100).toFixed(1)}%
                                  </span>
                                </>
                              ) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-red-600 dark:text-red-400">₹{s.stop_loss.toFixed(2)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                              {t1 ? <><span className="block">₹{t1.toFixed(2)}</span><span className="text-[10px] text-zinc-500">{t1pct}</span></> : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-emerald-800 dark:text-emerald-500">
                              {t2 ? <><span className="block">₹{t2.toFixed(2)}</span><span className="text-[10px] text-zinc-500">{t2pct}</span></> : '—'}
                            </td>
                            <td className={`px-3 py-2 text-xs font-bold ${s.risk_reward_ratio >= 2 ? 'text-emerald-700 dark:text-emerald-400' : s.risk_reward_ratio >= 1.5 ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                              {s.risk_reward_ratio.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-xs text-zinc-400">{s.holding_period}</td>
                            <td className="px-3 py-2">
                              {!['NEUTRAL', 'SELL', 'STRONG_SELL'].includes(s.signal) && (
                                <Link href={`/paper?symbol=${encodeURIComponent(s.symbol)}&signal=${s.signal.replace('STRONG_', '')}`}
                                  className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 whitespace-nowrap">
                                  Trade →
                                </Link>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right column (1/3) */}
          <div className="space-y-5">
            {/* Open Positions */}
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Open Positions</p>
                <Link href="/paper" className="text-xs text-indigo-500 hover:text-indigo-700">View all →</Link>
              </div>
              <div className="px-1">
                <OpenPositions trades={trades.slice(0, 5)} />
              </div>
            </div>

            {/* Active Alerts */}
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Active Price Alerts</p>
                <Link href="/alerts" className="text-xs text-indigo-500 hover:text-indigo-700">Manage →</Link>
              </div>
              {alerts.length === 0 ? (
                <p className="px-4 py-5 text-xs text-zinc-400">No active alerts. Set one from the Alerts page.</p>
              ) : (
                <ul className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                  {alerts.slice(0, 5).map(a => (
                    <li key={a.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{a.symbol.replace(/\.(NS|BO)$/, '')}</p>
                        <p className="text-[10px] text-zinc-400">{a.direction} ₹{a.price_target}</p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        {a.direction}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sector Heat Map */}
            <SectorHeatMap picks={picks} />

            {/* Quick links */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wide">Quick Access</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { href: '/discovery', label: 'Discovery' },
                  { href: '/forecast', label: 'Forecast' },
                  { href: '/alerts', label: 'Alerts' },
                  { href: '/paper', label: 'Paper Trading' },
                  { href: '/market-pulse', label: 'Market Pulse' },
                  { href: '/reports', label: 'Reports' },
                ].map(({ href, label }) => (
                  <Link key={href} href={href}
                    className="rounded-lg border border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300">
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import {
  getMe, getTopPicks, getDiscoveryStatus, listTrades, listAlerts, getQuote,
} from '@/lib/api'
import type { User, StockScore, DiscoveryStatus, Trade, AlertRule } from '@/lib/api'

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

// ── Main view ─────────────────────────────────────────────────────────────────

export default function DashboardView() {
  const router = useRouter()
  const tokenRef = useRef('')

  const [user, setUser]         = useState<User | null>(null)
  const [picks, setPicks]       = useState<StockScore[] | null>(null)
  const [status, setStatus]     = useState<DiscoveryStatus | null>(null)
  const [trades, setTrades]     = useState<Trade[]>([])
  const [alerts, setAlerts]     = useState<AlertRule[]>([])
  const [sortKey, setSortKey]   = useState<SortKey>('signal')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [sigFilter, setSigFilter] = useState<string>('All')
  const [ltps, setLtps]         = useState<Record<string, number>>({})

  const load = useCallback(async (token: string) => {
    const [me, p, s, t, a] = await Promise.all([
      getMe(token),
      getTopPicks(token, 50, undefined, 0),
      getDiscoveryStatus(token),
      listTrades(token, 'open').catch(() => [] as Trade[]),
      listAlerts(token).catch(() => [] as AlertRule[]),
    ])
    setUser(me)
    setPicks(p)
    setStatus(s)
    setTrades((t as Trade[]).filter((tr: Trade) => tr.status === 'open'))
    setAlerts((a as AlertRule[]).filter((al: AlertRule) => !al.triggered))
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const run = async () => { try { await load(t) } catch { router.replace('/login') } }
    void run()
  }, [router, load])

  // Fetch LTPs for all picks after picks load — fire and forget so display isn't blocked
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

  const lastScan = status?.last_scan_at
    ? new Date(status.last_scan_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST'
    : '—'

  const sigCounts = picks
    ? Object.fromEntries(
        ['STRONG_BUY', 'BUY', 'WATCH'].map(s => [s, picks.filter(p => p.signal === s).length])
      )
    : {}

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Dashboard" />
      <main className="mx-auto max-w-7xl px-4 py-8">

        {/* Greeting */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {user ? `Welcome back, ${user.full_name.split(' ')[0]}` : 'Dashboard'}
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Last scan: {lastScan} · {status?.stocks_scanned ?? 0} stocks · Next scan every 5 min
            </p>
          </div>
          <Link href="/discovery"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            Full Discovery →
          </Link>
        </div>

        {/* Stats row */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
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

        {/* Two-column layout */}
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Left — AI Picks (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              {/* Header + signal filter */}
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

              {/* Picks table */}
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
                        <SortTh label="Score" k="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
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
                              {t1 ? <>₹{t1.toFixed(2)}<span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{t1pct}</span></> : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-emerald-800 dark:text-emerald-500">
                              {t2 ? <>₹{t2.toFixed(2)}<span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{t2pct}</span></> : '—'}
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

            {/* Quick links */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wide">Quick Access</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { href: '/discovery', label: 'Discovery' },
                  { href: '/reports', label: 'Reports' },
                  { href: '/alerts', label: 'Alerts' },
                  { href: '/paper', label: 'Paper Trading' },
                  { href: '/market-pulse', label: 'Market Pulse' },
                  { href: '/admin', label: 'Admin' },
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

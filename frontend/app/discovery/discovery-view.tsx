'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import {
  getDiscoveryStatus,
  getTopPicks,
  getDiscoveryNews,
  triggerDiscoveryScan,
  getMe,
} from '@/lib/api'
import type { StockScore, DiscoveryStatus, DiscoveryNewsItem, User } from '@/lib/api'

const SIGNAL_STYLES: Record<string, string> = {
  STRONG_BUY:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
  BUY:         'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
  WATCH:       'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  NEUTRAL:     'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  SELL:        'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400',
  STRONG_SELL: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300',
}

const FILTERS = ['All', 'STRONG_BUY', 'BUY', 'WATCH', 'NEUTRAL', 'SELL', 'STRONG_SELL'] as const
type FilterType = typeof FILTERS[number]

type SortKey = 'signal' | 'score' | 'entry_price' | 'risk_reward_ratio' | 'stop_loss'
type SortDir = 'asc' | 'desc'

const SIGNAL_RANK: Record<string, number> = {
  STRONG_BUY: 6, BUY: 5, WATCH: 4, NEUTRAL: 3, SELL: 2, STRONG_SELL: 1,
}

function sortPicks(picks: StockScore[], key: SortKey, dir: SortDir): StockScore[] {
  return [...picks].sort((a, b) => {
    const av = key === 'signal' ? (SIGNAL_RANK[a.signal] ?? 0) : (a[key] as number)
    const bv = key === 'signal' ? (SIGNAL_RANK[b.signal] ?? 0) : (b[key] as number)
    return dir === 'desc' ? bv - av : av - bv
  })
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

function CompositeBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{score.toFixed(0)}</span>
    </div>
  )
}

function ExpandedRow({ s, onClose }: { s: StockScore; onClose: () => void }) {
  return (
    <tr>
      <td colSpan={9} className="bg-zinc-50 px-6 py-5 dark:bg-zinc-900">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-400">Price Levels</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Entry</span>
                <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{s.entry_price.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Stop Loss</span>
                <span className="font-mono font-semibold text-red-600 dark:text-red-400">₹{s.stop_loss.toFixed(2)}</span>
              </div>
              {s.targets.map((t, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-zinc-500">T{i + 1}</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">₹{t.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-zinc-200 pt-1 dark:border-zinc-700">
                <span className="text-zinc-500">R:R (T1)</span>
                <span className={`font-bold ${s.risk_reward_ratio >= 2 ? 'text-emerald-700 dark:text-emerald-400' : s.risk_reward_ratio >= 1.5 ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                  {s.risk_reward_ratio.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Hold</span>
                <span className="text-zinc-700 dark:text-zinc-200">{s.holding_period}</span>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-400">Score Breakdown</p>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Technical (40%)', value: s.technical_score, color: 'bg-indigo-500' },
                { label: 'News (30%)',       value: s.news_score,      color: 'bg-amber-400' },
                { label: 'ML Model (20%)',   value: s.ml_score,        color: 'bg-violet-500' },
                { label: 'Social (10%)',     value: s.social_score,    color: 'bg-zinc-400' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className="mb-0.5 flex justify-between text-zinc-500">
                    <span>{label}</span><span>{value.toFixed(0)}</span>
                  </div>
                  <ScoreBar value={value} color={color} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-400">Detected Patterns</p>
            {s.patterns.length === 0 ? (
              <p className="text-xs text-zinc-400">No strong patterns</p>
            ) : (
              <ul className="space-y-1">
                {s.patterns.map((p, i) => (
                  <li key={i} className="text-xs text-zinc-600 dark:text-zinc-300">· {p}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs italic text-zinc-500">{s.explanation}</p>
            {!['NEUTRAL', 'SELL', 'STRONG_SELL'].includes(s.signal) && (
              <Link
                href={`/paper?symbol=${encodeURIComponent(s.symbol)}&signal=${s.signal.replace('STRONG_', '')}`}
                className="mt-3 inline-block rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Paper trade →
              </Link>
            )}
          </div>
        </div>
        <button onClick={onClose} className="mt-3 text-xs text-zinc-400 hover:text-zinc-600">
          ▲ Collapse
        </button>
      </td>
    </tr>
  )
}

export default function DiscoveryView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  // null = not yet loaded (show skeleton); [] = loaded but empty
  const [picks, setPicks] = useState<StockScore[] | null>(null)
  const [news, setNews] = useState<DiscoveryNewsItem[] | null>(null)
  const [filter, setFilter] = useState<FilterType>('All')
  const [sortKey, setSortKey] = useState<SortKey>('signal')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [tab, setTab] = useState<'picks' | 'news'>('picks')
  const [scanning, setScanning] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Track filter requests so we don't race
  const filterRef = useRef<FilterType>('All')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    Promise.all([
      getMe(t),
      getTopPicks(t, 50, undefined, 0),
      getDiscoveryStatus(t),
    ])
      .then(([u, p, s]) => {
        setUser(u)
        setPicks(p)
        setStatus(s)
      })
      .catch(() => setError('Failed to load. Run a scan first.'))
  }, [router])

  useEffect(() => {
    if (tab !== 'news' || !tokenRef.current) return
    getDiscoveryNews(tokenRef.current, undefined, 100)
      .then(items => setNews(items))
      .catch(() => setNews([]))
  }, [tab])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function handleFilter(f: FilterType) {
    setFilter(f)
    filterRef.current = f
    const sig = f === 'All' ? undefined : f
    getTopPicks(tokenRef.current, 50, sig, 0)
      .then(p => { if (filterRef.current === f) setPicks(p) })
      .catch(() => null)
  }

  async function triggerScan() {
    setScanning(true)
    try {
      await triggerDiscoveryScan(tokenRef.current)
      setError(null)
      setTimeout(() => {
        Promise.all([
          getTopPicks(tokenRef.current, 50, filter === 'All' ? undefined : filter, 0),
          getDiscoveryStatus(tokenRef.current),
        ]).then(([p, s]) => { setPicks(p); setStatus(s) }).catch(() => null)
      }, 8000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan trigger failed')
    } finally { setScanning(false) }
  }

  const sentColor = (s: number) =>
    s > 0.1 ? 'text-emerald-600 dark:text-emerald-400' : s < -0.1 ? 'text-red-500 dark:text-red-400' : 'text-zinc-400'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Discovery" />
      <main className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Discovery Engine</h1>
            <p className="text-xs text-zinc-400">
              Scans {status?.universe_size ?? '~150'} NSE stocks · 20+ news sources · Technical + ML + Sentiment
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {status && (
              <div className="text-right text-xs text-zinc-400">
                {status.last_scan_at
                  ? <span>Last scan: {new Date(status.last_scan_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</span>
                  : <span className="text-amber-700 dark:text-amber-400">No scan yet</span>}
                {status.scheduler_active && (
                  <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-emerald-500" title="Scheduler active" />
                )}
              </div>
            )}
            {user?.role === 'admin' && (
              <button
                onClick={triggerScan}
                disabled={scanning || status?.is_running}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {scanning || status?.is_running ? 'Scanning…' : '⟳ Scan Now'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {(['picks', 'news'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}`}
            >
              {t === 'picks' ? `Top Picks${picks !== null ? ` (${picks.length})` : ''}` : 'News Feed'}
            </button>
          ))}
        </div>

        {/* Top Picks */}
        {tab === 'picks' && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {FILTERS.map(f => (
                <button key={f} onClick={() => handleFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}
                >
                  {f}
                </button>
              ))}
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {error}
                {user?.role === 'admin' && (
                  <button onClick={triggerScan} className="ml-3 font-semibold underline">Run scan now</button>
                )}
              </div>
            )}

            {picks === null ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                ))}
              </div>
            ) : picks.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm font-medium text-zinc-500">No picks found.</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {user?.role === 'admin'
                    ? 'Click "Scan Now" to run the first discovery scan.'
                    : 'Scans run every 5 min during market hours (09:15–15:30 IST).'}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {([
                        { h: '#',    key: null },
                        { h: 'Symbol', key: null },
                        { h: 'Score',  key: 'score' as SortKey },
                        { h: 'Signal', key: 'signal' as SortKey },
                        { h: 'Entry',  key: 'entry_price' as SortKey },
                        { h: 'Stop',   key: 'stop_loss' as SortKey },
                        { h: 'T1',     key: null },
                        { h: 'T2',     key: null },
                        { h: 'T3',     key: null },
                        { h: 'R:R',    key: 'risk_reward_ratio' as SortKey },
                        { h: 'Hold',   key: null },
                      ]).map(({ h, key }) => (
                        <th
                          key={h}
                          onClick={() => key && handleSort(key)}
                          className={`px-3 py-3 text-left text-xs font-medium select-none ${
                            key ? 'cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200' : ''
                          } ${
                            h === 'T1' ? 'text-emerald-600 dark:text-emerald-400'
                            : h === 'T2' ? 'text-emerald-700 dark:text-emerald-500'
                            : h === 'T3' ? 'text-emerald-800 dark:text-emerald-600'
                            : sortKey === key ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-zinc-500'
                          }`}
                        >
                          {h}{key && sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : key ? ' ⇅' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortPicks(picks, sortKey, sortDir).map((s, idx) => (
                      <>
                        <tr
                          key={s.id}
                          onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                          className="cursor-pointer border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30"
                        >
                          <td className="px-3 py-2.5 text-xs text-zinc-400">{idx + 1}</td>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-zinc-900 dark:text-zinc-50">{s.symbol.replace(/\.(NS|BO)$/, '')}</p>
                            <p className="text-[10px] text-zinc-400">{s.name}</p>
                          </td>
                          <td className="px-3 py-2.5"><CompositeBar score={s.score} /></td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLES[s.signal] ?? ''}`}>{s.signal}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">₹{s.entry_price.toFixed(2)}</td>
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-red-600 dark:text-red-400">
                            ₹{s.stop_loss.toFixed(2)}
                            <span className="block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                              {s.entry_price > 0 ? `${(((s.stop_loss - s.entry_price) / s.entry_price) * 100).toFixed(1)}%` : ''}
                            </span>
                          </td>
                          {[0, 1, 2].map(i => (
                            <td key={i} className="px-3 py-2.5 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              {s.targets[i] != null ? (
                                <>
                                  ₹{s.targets[i].toFixed(2)}
                                  <span className="block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                                    +{(((s.targets[i] - s.entry_price) / s.entry_price) * 100).toFixed(1)}%
                                  </span>
                                </>
                              ) : <span className="text-zinc-400">—</span>}
                            </td>
                          ))}
                          <td className={`px-3 py-2.5 text-xs font-bold ${s.risk_reward_ratio >= 2 ? 'text-emerald-700 dark:text-emerald-400' : s.risk_reward_ratio >= 1.5 ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                            {s.risk_reward_ratio.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">{s.holding_period}</td>
                        </tr>
                        {expandedId === s.id && (
                          <ExpandedRow key={`${s.id}-exp`} s={s} onClose={() => setExpandedId(null)} />
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* News Feed */}
        {tab === 'news' && (
          news === null ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
            </div>
          ) : news.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">No news yet. Run a scan to fetch the latest financial news.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {news.map(n => (
                <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
                  className="block rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/30 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 line-clamp-1 dark:text-zinc-50">{n.title}</p>
                      {n.summary && <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">{n.summary}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] text-zinc-400">{n.source}</span>
                        <span className="text-[10px] text-zinc-300 dark:text-zinc-600">·</span>
                        <span className="text-[10px] text-zinc-400">{new Date(n.published_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</span>
                        {n.mentioned_symbols.slice(0, 4).map(sym => (
                          <span key={sym} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {sym.replace(/\.(NS|BO)$/, '')}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs font-bold ${sentColor(n.sentiment_score)}`}>
                      {n.sentiment_score > 0 ? '+' : ''}{(n.sentiment_score * 100).toFixed(0)}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  )
}

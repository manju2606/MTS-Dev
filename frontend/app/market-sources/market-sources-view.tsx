'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import {
  compareQuoteSources,
  getMarketSources,
  getSourceHealth,
  type MarketSourceInfo,
  type MultiSourceQuote,
  type SourceHealthEntry,
} from '@/lib/api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | undefined, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(dec)
}

function fmtVol(n: number | undefined) {
  if (n == null) return '—'
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(2)} Cr`
  if (n >= 1_00_000)    return `${(n / 1_00_000).toFixed(2)} L`
  return n.toLocaleString()
}

// ── Icon ──────────────────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  checkCircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  xCircle:     'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9l-6 6M9 9l6 6',
  alertCircle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 8v4m0 4h.01',
  refresh:     'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  zap:         'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  database:    'M12 2C6.477 2 2 4.239 2 7v10c0 2.761 4.477 5 10 5s10-2.239 10-5V7c0-2.761-4.477-5-10-5zM2 12c0 2.761 4.477 5 10 5s10-2.239 10-5M2 7c0 2.761 4.477 5 10 5s10-2.239 10-5',
  search:      'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
  clock:       'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v5l3 3',
  shield:      'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  newspaper:   'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2M18 14h-8M15 18h-5M10 6h8v4h-8V6z',
}

function Icon({ name, size = 15, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

// ── HealthBadge ───────────────────────────────────────────────────────────────

function HealthBadge({ healthy }: { healthy: boolean }) {
  return healthy ? (
    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <span className="text-[11px] font-semibold">Healthy</span>
    </span>
  ) : (
    <span className="flex items-center gap-1 text-red-500">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      <span className="text-[11px] font-semibold">Degraded</span>
    </span>
  )
}

// ── SourceHealthCard ──────────────────────────────────────────────────────────

function SourceHealthCard({
  info,
  health,
}: {
  info: MarketSourceInfo
  health: SourceHealthEntry | undefined
}) {
  const total   = (health?.success ?? 0) + (health?.failure ?? 0)
  const rate    = total === 0 ? null : Math.round(((health?.success ?? 0) / total) * 100)
  const isNews  = info.news_only

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
            <Icon name={isNews ? 'newspaper' : 'database'} size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{info.name}</p>
            <p className="text-[11px] text-zinc-400">
              Priority: {info.priority ?? 'N/A'}
              {isNews && ' · News only'}
            </p>
          </div>
        </div>
        {isNews ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
            NEWS
          </span>
        ) : health ? (
          <HealthBadge healthy={health.healthy} />
        ) : (
          <span className="text-[11px] text-zinc-400">No data yet</span>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        {info.description}
      </p>

      <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <div>
          <p className="text-[10px] text-zinc-400">Delay</p>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{info.delay}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Coverage</p>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">{info.coverage}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Success rate</p>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {rate == null ? '—' : `${rate}%`}
            {total > 0 && <span className="text-zinc-400"> ({total})</span>}
          </p>
        </div>
      </div>

      {health?.last_error && (
        <p className="truncate rounded-lg bg-red-50 px-2 py-1 text-[10px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          Last error: {health.last_error}
        </p>
      )}
    </div>
  )
}

// ── QuoteCompare ──────────────────────────────────────────────────────────────

function CompareTable({ result }: { result: MultiSourceQuote }) {
  const working = result.sources.filter(s => s.ok)
  const avgPrice = working.length
    ? working.reduce((a, s) => a + (s.price ?? 0), 0) / working.length
    : null

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between bg-zinc-50 px-4 py-2.5 dark:bg-zinc-800/50">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {result.symbol}
        </p>
        {avgPrice != null && (
          <p className="text-xs text-zinc-500">
            Avg price: <span className="font-semibold text-zinc-800 dark:text-zinc-200">₹{fmt(avgPrice)}</span>
          </p>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-400">
            <th className="px-4 py-2 text-left">Source</th>
            <th className="px-4 py-2 text-right">Price (₹)</th>
            <th className="px-4 py-2 text-right">Change %</th>
            <th className="px-4 py-2 text-right">Volume</th>
            <th className="px-4 py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.sources.map((s, i) => {
            const delta = avgPrice && s.price ? ((s.price - avgPrice) / avgPrice) * 100 : null
            return (
              <tr
                key={s.source}
                className={`border-b border-zinc-50 dark:border-zinc-800/50 ${
                  i % 2 === 0 ? '' : 'bg-zinc-50/50 dark:bg-zinc-800/20'
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-200 capitalize">
                  {s.source.replace('_', ' ')}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {s.ok && s.price ? (
                    <span>
                      ₹{fmt(s.price)}
                      {delta != null && Math.abs(delta) > 0.01 && (
                        <span className={`ml-1 text-[10px] ${delta > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  ) : '—'}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${
                  (s.change_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                }`}>
                  {s.ok && s.change_pct != null
                    ? `${s.change_pct >= 0 ? '+' : ''}${fmt(s.change_pct)}%`
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-400">
                  {s.ok ? fmtVol(s.volume) : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {s.ok ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <Icon name="checkCircle" size={10} />
                      OK
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-400">
                      <Icon name="xCircle" size={10} />
                      Failed
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {result.sources.some(s => !s.ok) && (
        <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          {result.sources.filter(s => !s.ok).map(s => (
            <p key={s.source} className="text-[10px] text-red-500">
              {s.source}: {s.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function MarketSourcesView() {
  const [sources,  setSources]  = useState<MarketSourceInfo[]>([])
  const [health,   setHealth]   = useState<SourceHealthEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [symbol,   setSymbol]   = useState('RELIANCE')
  const [comparing, setComparing] = useState(false)
  const [result,   setResult]   = useState<MultiSourceQuote | null>(null)
  const [cmpError, setCmpError] = useState('')
  const token = useRef('')

  useEffect(() => {
    token.current = localStorage.getItem('mts_token') ?? ''
    Promise.all([
      getMarketSources(token.current),
      getSourceHealth(token.current),
    ]).then(([src, hlth]) => {
      setSources(src)
      setHealth(hlth)
    }).finally(() => setLoading(false))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const hlth = await getSourceHealth(token.current)
      setHealth(hlth)
    } finally {
      setLoading(false)
    }
  }, [])

  const compare = useCallback(async () => {
    const sym = symbol.trim().toUpperCase().replace('.NS', '').replace('.BO', '')
    if (!sym) return
    setComparing(true)
    setCmpError('')
    setResult(null)
    try {
      const r = await compareQuoteSources(token.current, sym)
      setResult(r)
    } catch (e) {
      setCmpError(String(e))
    } finally {
      setComparing(false)
    }
  }, [symbol])

  const healthMap = Object.fromEntries(health.map(h => [h.source, h]))
  const quoteSrcs = sources.filter(s => !s.news_only)
  const newsSrcs  = sources.filter(s => s.news_only)

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Data Sources" />

      <main className="mx-auto max-w-6xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow">
              <Icon name="database" size={18} />
            </span>
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Market Data Sources</h1>
              <p className="text-xs text-zinc-500">
                5 sources configured · priority chain with auto-fallback
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <Icon name="refresh" size={13} className={loading ? 'animate-spin' : ''} />
            Refresh health
          </button>
        </div>

        {/* Priority legend */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mr-1">Priority chain:</span>
          {quoteSrcs
            .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
            .map((s, i, arr) => (
              <span key={s.id} className="flex items-center gap-1">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  {s.priority}
                </span>
                <span className="text-xs text-zinc-700 dark:text-zinc-300">{s.name}</span>
                {i < arr.length - 1 && (
                  <span className="text-zinc-300 dark:text-zinc-700">→</span>
                )}
              </span>
            ))}
          <span className="ml-auto text-[10px] text-zinc-400">First healthy source with non-zero price wins</span>
        </div>

        {/* Source cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading && sources.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
              ))
            : sources.map(src => (
                <SourceHealthCard
                  key={src.id}
                  info={src}
                  health={healthMap[src.id]}
                />
              ))}
        </div>

        {/* Quote comparison tool */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="search" size={16} className="text-indigo-500" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Compare Quote Across Sources</h2>
          </div>

          <div className="flex gap-2">
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && compare()}
              placeholder="NSE symbol, e.g. RELIANCE"
              className="flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:ring-indigo-900/40"
            />
            <button
              onClick={compare}
              disabled={comparing}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              {comparing ? (
                <>
                  <Icon name="refresh" size={14} className="animate-spin" />
                  Fetching…
                </>
              ) : (
                <>
                  <Icon name="zap" size={14} />
                  Compare
                </>
              )}
            </button>
          </div>

          {cmpError && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {cmpError}
            </p>
          )}

          {result && (
            <div className="mt-4">
              <CompareTable result={result} />
            </div>
          )}

          {!result && !comparing && !cmpError && (
            <p className="mt-4 text-center text-xs text-zinc-400">
              Enter a symbol and click Compare to fetch quotes from all 4 active sources simultaneously
            </p>
          )}
        </div>

        {/* News-only sources note */}
        {newsSrcs.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 dark:border-amber-900/30 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <Icon name="newspaper" size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  News-only sources: {newsSrcs.map(s => s.name).join(', ')}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                  These are integrated as RSS news feeds and do not provide live price data.
                  Quote data for these markets is sourced via NSE India (priority 1).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <InfoCard
            icon="zap"
            title="Auto-fallback"
            body="If the primary source (NSE India) is unhealthy, the system automatically falls back to Yahoo Finance, then MoneyControl, then Google Finance."
          />
          <InfoCard
            icon="shield"
            title="Health tracking"
            body="Each source tracks success/failure counts. After 3 consecutive failures a 2-minute back-off is applied. Health resets on next success."
          />
          <InfoCard
            icon="clock"
            title="Cache & latency"
            body="NSE India quotes are near real-time. Yahoo Finance has a 15-min delay. All sources are called concurrently for comparison mode."
          />
        </div>
      </main>
    </div>
  )
}

function InfoCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon name={icon} size={13} className="text-indigo-500" />
        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{title}</p>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
    </div>
  )
}

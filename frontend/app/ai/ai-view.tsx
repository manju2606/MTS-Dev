'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { analyzeBatch, getAIHistory, getEnsembleSignal, getQuote, getWatchlistItems, listWatchlists } from '@/lib/api'
import type { AIRecommendation, AISignalRecord, EnsembleSignal, Watchlist } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'
import Link from 'next/link'

// ── Signal helpers ────────────────────────────────────────────────────────────

const SIGNAL_RANK: Record<string, number> = { BUY: 3, HOLD: 2, SELL: 1 }

const SIGNAL_BADGE: Record<string, string> = {
  BUY:  'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-300 dark:ring-emerald-700',
  SELL: 'bg-red-100 text-red-700 ring-red-300 dark:bg-red-900/60 dark:text-red-300 dark:ring-red-700',
  HOLD: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/60 dark:text-amber-300 dark:ring-amber-700',
}

const SIGNAL_TEXT: Record<string, string> = {
  BUY:  'text-emerald-700 dark:text-emerald-400',
  SELL: 'text-red-600 dark:text-red-400',
  HOLD: 'text-amber-700 dark:text-amber-400',
}

type SortKey = 'signal' | 'confidence' | 'risk_reward_ratio' | 'entry_price'
type SortDir = 'asc' | 'desc'

function sortRecs(arr: AIRecommendation[], key: SortKey, dir: SortDir): AIRecommendation[] {
  return [...arr].sort((a, b) => {
    const av = key === 'signal' ? (SIGNAL_RANK[a.signal] ?? 0) : (a[key] as number)
    const bv = key === 'signal' ? (SIGNAL_RANK[b.signal] ?? 0) : (b[key] as number)
    return dir === 'desc' ? bv - av : av - bv
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfBar({ pct }: { pct: number }) {
  const w = Math.round(pct * 100)
  const color = w >= 70 ? 'bg-emerald-500' : w >= 50 ? 'bg-amber-400' : 'bg-zinc-300 dark:bg-zinc-600'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-zinc-500 dark:text-zinc-400">{w}%</span>
    </div>
  )
}

function LTPBadge({ entry, ltp }: { entry: number; ltp: number | null }) {
  if (ltp === null) return <span className="text-xs text-zinc-400">—</span>
  const diff = ((ltp - entry) / entry) * 100
  const cls = diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300'
  return (
    <div>
      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">₹{ltp.toFixed(2)}</span>
      <span className={`ml-1.5 text-[10px] font-medium ${cls}`}>
        {diff > 0 ? '+' : ''}{diff.toFixed(2)}%
      </span>
    </div>
  )
}

function RecCard({ rec, ltp }: { rec: AIRecommendation; ltp: number | null }) {
  const sym = rec.symbol.replace(/\.(NS|BO)$/, '')
  const rrColor = rec.risk_reward_ratio >= 2
    ? 'text-emerald-700 dark:text-emerald-400'
    : rec.risk_reward_ratio >= 1.5 ? 'text-amber-700 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="text-xs text-zinc-400">{rec.symbol.includes('.BO') ? 'BSE' : 'NSE'}</p>
          <div className="mt-1">
            <LTPBadge entry={rec.entry_price} ltp={ltp} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${SIGNAL_BADGE[rec.signal] ?? SIGNAL_BADGE.HOLD}`}>
            {rec.signal}
          </span>
          <span className={`text-[10px] font-medium ${rec.engine === 'claude' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`}>
            {rec.engine === 'claude' ? '✦ Claude' : 'Rule-based'}
          </span>
        </div>
      </div>

      {/* Confidence */}
      <div>
        <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Confidence</p>
        <ConfBar pct={rec.confidence} />
      </div>

      {/* Price grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-500 dark:text-zinc-400">Entry</p>
          <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{rec.entry_price.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <p className="text-zinc-500 dark:text-zinc-400">Stop Loss</p>
          <p className={`font-mono font-semibold ${SIGNAL_TEXT.SELL}`}>₹{rec.stop_loss.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="text-zinc-500 dark:text-zinc-400">Target</p>
          <p className={`font-mono font-semibold ${SIGNAL_TEXT.BUY}`}>₹{rec.target.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-500 dark:text-zinc-400">R:R</p>
          <p className={`font-mono font-semibold ${rrColor}`}>{rec.risk_reward_ratio.toFixed(2)}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Hold: <span className="text-zinc-700 dark:text-zinc-300">{rec.holding_period}</span>
      </p>

      <p className="text-xs italic text-zinc-500 dark:text-zinc-400">{rec.explanation}</p>

      {rec.signal !== 'HOLD' && (
        <Link
          href={`/paper?symbol=${encodeURIComponent(rec.symbol)}&signal=${rec.signal}`}
          className="mt-1 rounded-lg bg-indigo-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Trade it →
        </Link>
      )}
    </div>
  )
}

// ── Sort bar ──────────────────────────────────────────────────────────────────

function SortBar({ sortKey, sortDir, onSort }: {
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  const options: { k: SortKey; label: string }[] = [
    { k: 'signal', label: 'Signal' },
    { k: 'confidence', label: 'Confidence' },
    { k: 'risk_reward_ratio', label: 'R:R' },
    { k: 'entry_price', label: 'Entry Price' },
  ]
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-400">Sort:</span>
      {options.map(({ k, label }) => (
        <button
          key={k}
          onClick={() => onSort(k)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            sortKey === k
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          {label}{sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
        </button>
      ))}
    </div>
  )
}

// ── Ensemble panel ────────────────────────────────────────────────────────────

function EnsemblePanel({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [sym, setSym] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EnsembleSignal | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!sym.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      setResult(await getEnsembleSignal(tokenRef.current, sym.trim()))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ensemble failed'
      setError(msg.includes('429') ? 'Daily AI call limit reached.' : msg)
    } finally { setLoading(false) }
  }

  const c = result?.consensus
  const sigText = c ? (SIGNAL_TEXT[c.signal] ?? 'text-zinc-700 dark:text-zinc-300') : ''

  return (
    <div className="space-y-5">
      <form onSubmit={run} className="flex gap-3">
        <input
          value={sym}
          onChange={e => setSym(e.target.value)}
          placeholder="Symbol (e.g. RELIANCE, TCS)"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
        <button
          type="submit"
          disabled={loading || !sym.trim()}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {loading ? 'Running…' : 'Run Ensemble'}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {result && c && (
        <div className="space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-indigo-950/40">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-indigo-500 dark:text-indigo-400">CONSENSUS</p>
                <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  {result.symbol.replace(/\.(NS|BO)$/, '')}
                </p>
              </div>
              <span className={`text-xl font-extrabold ${sigText}`}>{c.signal}</span>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Confidence</span>
                <span>{(c.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${c.confidence * 100}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                { label: 'Entry', value: `₹${c.entry_price.toFixed(2)}`, cls: 'text-zinc-800 dark:text-zinc-200' },
                { label: 'Stop', value: `₹${c.stop_loss.toFixed(2)}`, cls: SIGNAL_TEXT.SELL },
                { label: 'Target', value: `₹${c.target.toFixed(2)}`, cls: SIGNAL_TEXT.BUY },
                { label: 'R:R', value: c.risk_reward_ratio.toFixed(2), cls: 'text-zinc-800 dark:text-zinc-200' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="rounded-lg bg-white px-2 py-2 dark:bg-zinc-900">
                  <p className="text-zinc-500 dark:text-zinc-400">{label}</p>
                  <p className={`font-mono font-semibold ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs italic text-indigo-700 dark:text-indigo-300">{c.explanation}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {result.engines.local && (() => {
              const e = result.engines.local!
              return (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Rule-based</p>
                  <p className={`text-lg font-bold ${SIGNAL_TEXT[e.signal] ?? 'text-zinc-700 dark:text-zinc-300'}`}>{e.signal}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{(e.confidence * 100).toFixed(0)}% confidence</p>
                  <p className="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400 line-clamp-3">{e.explanation}</p>
                </div>
              )
            })()}

            {result.engines.ml && (() => {
              const ml = result.engines.ml!
              const up = ml.prediction === 'UP'
              return (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">ML Model</p>
                  <p className={`text-lg font-bold ${up ? SIGNAL_TEXT.BUY : SIGNAL_TEXT.SELL}`}>{ml.prediction}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{(ml.probability * 100).toFixed(0)}% probability</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">CV accuracy: {(ml.accuracy_cv * 100).toFixed(0)}%</p>
                  {Object.keys(ml.top_features ?? {}).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {Object.entries(ml.top_features ?? {}).slice(0, 3).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                          <span>{k}</span><span>{(Number(v) * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {result.engines.claude ? (() => {
              const cl = result.engines.claude!
              return (
                <div className="rounded-xl border border-indigo-200 bg-white p-4 dark:border-indigo-900/30 dark:bg-zinc-900">
                  <p className="mb-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">✦ Claude</p>
                  <p className={`text-lg font-bold ${SIGNAL_TEXT[cl.signal] ?? 'text-zinc-700 dark:text-zinc-300'}`}>{cl.signal}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{(cl.confidence * 100).toFixed(0)}% confidence</p>
                  <p className="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400 line-clamp-3">{cl.explanation}</p>
                </div>
              )
            })() : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-xs font-semibold text-indigo-500 dark:text-indigo-400">✦ Claude</p>
                <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Set <code className="rounded bg-zinc-100 px-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">ANTHROPIC_API_KEY</code> to enable
                </p>
              </div>
            )}
          </div>

          {c.signal !== 'HOLD' && (
            <Link
              href={`/paper?symbol=${encodeURIComponent(result.symbol)}&signal=${c.signal}`}
              className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Trade consensus →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function AIView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [recs, setRecs] = useState<AIRecommendation[]>([])
  const [ltps, setLtps] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'signals' | 'history' | 'ensemble'>('signals')
  const [history, setHistory] = useState<AISignalRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('signal')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    listWatchlists(t).then(wls => {
      setWatchlists(wls)
      if (wls.length > 0) setSelectedId(wls[0].id)
    }).catch(() => {})
  }, [router])

  useEffect(() => {
    if (tab !== 'history' || !tokenRef.current) return
    setHistoryLoading(true)
    getAIHistory(tokenRef.current, undefined, 100)
      .then(setHistory)
      .finally(() => setHistoryLoading(false))
  }, [tab])

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const analyzeAll = useCallback(async () => {
    if (!selectedId) { setError('Select a watchlist first.'); return }
    setLoading(true); setError(null)
    try {
      const items = await getWatchlistItems(tokenRef.current, selectedId)
      if (items.length === 0) { setError('This watchlist is empty. Add symbols on the dashboard.'); return }
      const results = await analyzeBatch(tokenRef.current, items.map(i => i.symbol))
      setRecs(results)
      // Fetch LTPs in parallel (best-effort)
      const prices: Record<string, number> = {}
      await Promise.allSettled(
        results.map(async r => {
          try {
            const q = await getQuote(tokenRef.current, r.symbol)
            prices[r.symbol] = q.price
          } catch { /* skip */ }
        })
      )
      setLtps(prices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally { setLoading(false) }
  }, [selectedId])

  const displayed = sortRecs(recs, sortKey, sortDir)

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="AI Analysis" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Analysis</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Rule-based + ML + Claude consensus — set{' '}
              <code className="rounded bg-zinc-100 px-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">ANTHROPIC_API_KEY</code>{' '}
              to enable Claude
            </p>
          </div>
          {tab === 'signals' && (
            <div className="flex items-center gap-2">
              {watchlists.length > 0 && (
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {watchlists.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={analyzeAll}
                disabled={loading || !selectedId}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Analysing…' : 'Analyse All'}
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {(['signals', 'ensemble', 'history'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {t === 'signals' ? 'Batch Signals' : t === 'ensemble' ? '✦ Ensemble' : 'Signal History'}
            </button>
          ))}
        </div>

        {tab === 'signals' && error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {tab === 'signals' && loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {tab === 'signals' && !loading && recs.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Select a watchlist and click <strong className="text-zinc-700 dark:text-zinc-200">Analyse All</strong>.
            </p>
          </div>
        )}

        {tab === 'signals' && !loading && recs.length > 0 && (
          <>
            <SortBar sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayed.map(r => <RecCard key={r.id} rec={r} ltp={ltps[r.symbol] ?? null} />)}
            </div>
          </>
        )}

        {tab === 'ensemble' && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Multi-Engine Ensemble</p>
            <p className="mb-5 text-xs text-zinc-500 dark:text-zinc-400">
              Runs Local rules + ML model + Claude (if configured) concurrently and aggregates a weighted consensus.
            </p>
            <EnsemblePanel tokenRef={tokenRef} />
          </div>
        )}

        {tab === 'history' && (
          historyLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No signals yet. Run <strong className="text-zinc-700 dark:text-zinc-200">Analyse All</strong> to see history here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    {['Date & Time', 'Symbol', 'Signal', 'Conf', 'Entry', 'Target', 'Stop', 'R:R', 'Hold', 'Engine'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map(s => {
                    const sigCls = SIGNAL_TEXT[s.signal as string] ?? 'text-zinc-600 dark:text-zinc-300'
                    return (
                      <tr key={s.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                          <div>{new Date(s.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</div>
                          <div className="text-zinc-500 dark:text-zinc-400">{new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</div>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-50">{s.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`px-3 py-2.5 font-bold ${sigCls}`}>{s.signal}</td>
                        <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{(s.confidence * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">₹{s.entry_price.toFixed(2)}</td>
                        <td className={`px-3 py-2.5 font-mono text-xs ${SIGNAL_TEXT.BUY}`}>₹{s.target.toFixed(2)}</td>
                        <td className={`px-3 py-2.5 font-mono text-xs ${SIGNAL_TEXT.SELL}`}>₹{s.stop_loss.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{s.risk_reward_ratio.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-xs text-zinc-400">{s.holding_period}</td>
                        <td className="px-3 py-2.5 text-xs text-zinc-400">{s.engine}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </main>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { analyzeBatch, getAIHistory, getWatchlistItems, listWatchlists } from '@/lib/api'
import type { AIRecommendation, AISignalRecord, Watchlist } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'
import Link from 'next/link'

type Signal = 'BUY' | 'SELL' | 'HOLD'

function SignalBadge({ signal }: { signal: Signal }) {
  const cls =
    signal === 'BUY'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
      : signal === 'SELL'
        ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
        : 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${cls}`}>
      {signal}
    </span>
  )
}

function ConfBar({ pct }: { pct: number }) {
  const w = Math.round(pct * 100)
  const color = w >= 70 ? 'bg-emerald-500' : w >= 50 ? 'bg-amber-400' : 'bg-zinc-300'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-zinc-500">{w}%</span>
    </div>
  )
}

function RecCard({ rec }: { rec: AIRecommendation }) {
  const sym = rec.symbol.replace(/\.(NS|BO)$/, '')
  const rrColor =
    rec.risk_reward_ratio >= 2
      ? 'text-emerald-600 dark:text-emerald-400'
      : rec.risk_reward_ratio >= 1.5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-500 dark:text-red-400'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="text-xs text-zinc-400">{rec.symbol.includes('.BO') ? 'BSE' : 'NSE'}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <SignalBadge signal={rec.signal as Signal} />
          <span className={`text-[10px] font-medium ${rec.engine === 'claude' ? 'text-indigo-500 dark:text-indigo-400' : 'text-zinc-400'}`}>
            {rec.engine === 'claude' ? '✦ Claude' : 'Rule-based'}
          </span>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-zinc-500">Confidence</p>
        <ConfBar pct={rec.confidence} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-400">Entry</p>
          <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">₹{rec.entry_price.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <p className="text-zinc-400">Stop Loss</p>
          <p className="font-mono font-semibold text-red-600 dark:text-red-400">₹{rec.stop_loss.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="text-zinc-400">Target</p>
          <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">₹{rec.target.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
          <p className="text-zinc-400">R:R</p>
          <p className={`font-mono font-semibold ${rrColor}`}>{rec.risk_reward_ratio.toFixed(2)}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-400">
        Hold: <span className="text-zinc-600 dark:text-zinc-300">{rec.holding_period}</span>
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

export default function AIView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [recs, setRecs] = useState<AIRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'signals' | 'history'>('signals')
  const [history, setHistory] = useState<AISignalRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

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

  const analyzeAll = useCallback(async () => {
    if (!selectedId) { setError('Select a watchlist first.'); return }
    setLoading(true)
    setError(null)
    try {
      const items = await getWatchlistItems(tokenRef.current, selectedId)
      if (items.length === 0) { setError('This watchlist is empty. Add symbols on the dashboard.'); return }
      const results = await analyzeBatch(tokenRef.current, items.map(i => i.symbol))
      setRecs(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="AI Analysis" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Analysis</h1>
            <p className="text-xs text-zinc-400">
              Technical analysis — Claude if API key set, rule-based otherwise
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === 'signals' && watchlists.length > 0 && (
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
            {tab === 'signals' && (
              <button
                onClick={analyzeAll}
                disabled={loading || !selectedId}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Analysing…' : 'Analyse All'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {(['signals', 'history'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
                tab === t
                  ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'
              }`}
            >
              {t === 'signals' ? 'Signals' : 'Signal History'}
            </button>
          ))}
        </div>

        {tab === 'signals' && error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
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
            <p className="text-sm text-zinc-500">
              Select a watchlist and click <strong>Analyse All</strong>.
            </p>
          </div>
        )}

        {tab === 'signals' && !loading && recs.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map(r => <RecCard key={r.id} rec={r} />)}
          </div>
        )}

        {/* Signal history tab */}
        {tab === 'history' && (
          historyLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">No signals generated yet. Run <strong>Analyse All</strong> to see history here.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    {['Date', 'Symbol', 'Signal', 'Conf', 'Entry', 'Target', 'Stop', 'R:R', 'Hold', 'Engine'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-medium text-zinc-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map(s => {
                    const sig = s.signal as 'BUY' | 'SELL' | 'HOLD'
                    const sigCls = sig === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : sig === 'SELL' ? 'text-red-500 dark:text-red-400' : 'text-amber-500'
                    return (
                      <tr key={s.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td className="px-3 py-2.5 text-xs text-zinc-400">{new Date(s.created_at).toLocaleDateString('en-IN')}</td>
                        <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-50">{s.symbol.replace(/\.(NS|BO)$/, '')}</td>
                        <td className={`px-3 py-2.5 font-bold ${sigCls}`}>{s.signal}</td>
                        <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{(s.confidence * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2.5 font-mono text-xs">₹{s.entry_price.toFixed(2)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-emerald-600 dark:text-emerald-400">₹{s.target.toFixed(2)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-red-500 dark:text-red-400">₹{s.stop_loss.toFixed(2)}</td>
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

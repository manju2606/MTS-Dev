'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { predictBatch, getWatchlist } from '@/lib/api'
import type { MLPrediction } from '@/lib/api'

function PredCard({ pred }: { pred: MLPrediction }) {
  const isUp = pred.prediction === 'UP'
  const pctConf = Math.round(pred.probability * 100)
  const accPct = Math.round(pred.accuracy_cv * 100)
  const sym = pred.symbol.replace(/\.(NS|BO)$/, '')
  const topFeatures = Object.entries(pred.feature_importances).sort((a, b) => b[1] - a[1]).slice(0, 4)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="text-xs text-zinc-400">{pred.symbol.includes('.BO') ? 'BSE' : 'NSE'} · {pred.training_samples} samples</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${isUp ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800' : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'}`}>
            {isUp ? '▲ UP' : '▼ DOWN'}
          </span>
          <span className="text-[10px] text-zinc-400">ML · RandomForest</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
          <p className="text-zinc-400">Confidence</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div className={`h-full rounded-full ${pctConf >= 70 ? 'bg-emerald-500' : pctConf >= 55 ? 'bg-amber-400' : 'bg-zinc-400'}`} style={{ width: `${pctConf}%` }} />
          </div>
          <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">{pctConf}%</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
          <p className="text-zinc-400">CV Accuracy</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${accPct}%` }} />
          </div>
          <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">{accPct}%</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs text-zinc-400">Top Features</p>
        <div className="flex flex-col gap-1">
          {topFeatures.map(([feat, imp]) => (
            <div key={feat} className="flex items-center gap-2">
              <span className="w-28 truncate text-[10px] text-zinc-500">{feat}</span>
              <div className="flex-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.round(imp * 100 * 10)}%` }} />
              </div>
              <span className="text-[10px] text-zinc-400">{(imp * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MLView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [preds, setPreds] = useState<MLPrediction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
  }, [router])

  const runAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const wl = await getWatchlist(tokenRef.current)
      if (!wl.length) { setError('Watchlist is empty — add symbols on the dashboard first.'); return }
      const results = await predictBatch(tokenRef.current, wl.map(i => i.symbol))
      setPreds(results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed')
    } finally { setLoading(false) }
  }, [])

  if (!authChecked) return null

  const upCount = preds.filter(p => p.prediction === 'UP').length
  const downCount = preds.filter(p => p.prediction === 'DOWN').length

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="ML Signals" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">ML Signals</h1>
            <p className="text-xs text-zinc-400">
              RandomForest trained on 2 years of daily data. Predicts next-day price direction.
              {preds.length > 0 && ` ${upCount} UP · ${downCount} DOWN`}
            </p>
          </div>
          <button
            onClick={runAll}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Training & predicting…' : 'Run All'}
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Training a RandomForest model for each symbol on 2 years of data. This takes 30–60 seconds…
          </div>
        )}

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {!loading && preds.length === 0 && !error && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              Click <strong>Run All</strong> to train ML models and get next-day direction predictions for your watchlist.
            </p>
            <p className="mt-1 text-xs text-zinc-400">Each model trains on 2 years of daily OHLCV data using 14 technical features.</p>
          </div>
        )}

        {!loading && preds.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {preds.map(p => <PredCard key={p.symbol} pred={p} />)}
          </div>
        )}
      </main>
    </div>
  )
}

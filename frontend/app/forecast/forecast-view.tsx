'use client'

import { useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getForecast, getForecastHistory } from '@/lib/api'
import type { ForecastAccuracyRecord, ForecastResult, HorizonForecast, ModelForecast } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtVol(n: number) {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
function dirColor(dir: string) {
  if (dir === 'UP')   return 'text-emerald-600 dark:text-emerald-400'
  if (dir === 'DOWN') return 'text-red-600 dark:text-red-400'
  return 'text-zinc-500 dark:text-zinc-400'
}
function dirBadge(dir: string) {
  if (dir === 'UP')   return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
  if (dir === 'DOWN') return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
  return 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'
}
function dirArrow(dir: string) {
  if (dir === 'UP')   return '▲'
  if (dir === 'DOWN') return '▼'
  return '→'
}
function modelLabel(m: string) {
  return m === 'random_forest' ? 'Random Forest'
    : m === 'gradient_boost'   ? 'Gradient Boost'
    : m === 'ridge'            ? 'Ridge Regression'
    : m
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-500">{pct}%</span>
    </div>
  )
}

function HorizonCard({ hf, active }: { hf: HorizonForecast; active: boolean }) {
  const dir = hf.direction
  return (
    <div className={`rounded-xl border p-5 transition-all ${
      active
        ? 'border-indigo-300 bg-indigo-50 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/40'
        : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
    }`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {hf.horizon === 'day' ? 'Tomorrow' : hf.horizon === 'week' ? '1 Week' : '1 Month'}
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">{hf.target_date}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${dirBadge(dir)}`}>
          {dirArrow(dir)} {dir}
        </span>
      </div>

      <div className="mt-3">
        <p className={`text-2xl font-bold tracking-tight ${dirColor(dir)}`}>
          ₹{fmt(hf.ensemble_price)}
        </p>
        <p className={`mt-0.5 text-sm font-medium ${dirColor(dir)}`}>
          {hf.ensemble_change_pct > 0 ? '+' : ''}{hf.ensemble_change_pct.toFixed(2)}%
        </p>
      </div>

      <div className="mt-2">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          Band: ₹{fmt(hf.lower_bound)} – ₹{fmt(hf.upper_bound)}
        </p>
      </div>
    </div>
  )
}

function ModelTable({ models, basePrice }: { models: ModelForecast[]; basePrice: number }) {
  const ensemble = models.reduce((s, m) => s + m.predicted_price, 0) / models.length
  const ensDir = ensemble > basePrice * 1.005 ? 'UP' : ensemble < basePrice * 0.995 ? 'DOWN' : 'FLAT'
  const ens: ModelForecast = {
    model: 'ensemble',
    predicted_price: Math.round(ensemble * 100) / 100,
    change_pct: Math.round((ensemble - basePrice) / (basePrice + 1e-9) * 10000) / 100,
    confidence: Math.round(models.reduce((s, m) => s + m.confidence, 0) / models.length * 1000) / 1000,
    direction: ensDir,
  }
  const rows = [...models, ens]

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Model</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Target ₹</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Change</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Direction</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const isEns = m.model === 'ensemble'
            return (
              <tr key={m.model} className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${
                isEns ? 'bg-indigo-50/50 dark:bg-indigo-950/20 font-semibold' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
              }`}>
                <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                  {isEns
                    ? <span className="font-bold text-indigo-700 dark:text-indigo-300">⊕ Ensemble avg</span>
                    : modelLabel(m.model)
                  }
                </td>
                <td className={`px-4 py-2.5 text-right text-xs font-mono ${dirColor(m.direction)}`}>
                  {fmt(m.predicted_price)}
                </td>
                <td className={`px-4 py-2.5 text-right text-xs font-mono ${dirColor(m.direction)}`}>
                  {m.change_pct > 0 ? '+' : ''}{m.change_pct.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${dirBadge(m.direction)}`}>
                    {dirArrow(m.direction)} {m.direction}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <ConfBar value={m.confidence} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AccuracyTable({ records }: { records: ForecastAccuracyRecord[] }) {
  if (!records.length) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No accuracy records yet — predictions resolve at 16:30 IST each trading day.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
            {['Date', 'Horizon', 'Model', 'Predicted ₹', 'Actual ₹', 'Error %', 'Direction'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, idx) => (
            <tr key={idx} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
              <td className="px-3 py-2 text-zinc-500">{r.target_date}</td>
              <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">{r.horizon}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{modelLabel(r.model)}</td>
              <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">₹{fmt(r.predicted_price)}</td>
              <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">
                {r.actual_price != null ? `₹${fmt(r.actual_price)}` : <span className="text-zinc-300">—</span>}
              </td>
              <td className="px-3 py-2 font-mono">
                {r.error_pct != null
                  ? <span className={r.error_pct < 2 ? 'text-emerald-600' : r.error_pct < 5 ? 'text-amber-500' : 'text-red-500'}>
                      {r.error_pct.toFixed(2)}%
                    </span>
                  : <span className="text-zinc-300">Pending</span>
                }
              </td>
              <td className="px-3 py-2">
                {r.direction_correct != null
                  ? r.direction_correct
                    ? <span className="text-emerald-600">✓ Correct</span>
                    : <span className="text-red-500">✗ Wrong</span>
                  : <span className="text-zinc-300">—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ForecastView() {
  const [query, setQuery]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ForecastResult | null>(null)
  const [history, setHistory]         = useState<ForecastAccuracyRecord[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [activeHorizon, setActiveHorizon] = useState<'day' | 'week' | 'month'>('day')

  async function analyse() {
    const sym = query.trim()
    if (!sym) return
    const token = localStorage.getItem('mts_token') ?? ''
    if (!token) return

    setLoading(true)
    setError(null)
    setResult(null)
    setHistory([])

    try {
      const normalised = sym.toUpperCase().endsWith('.NS') || sym.toUpperCase().endsWith('.BO')
        ? sym.toUpperCase()
        : `${sym.toUpperCase()}.NS`

      const [res, hist] = await Promise.allSettled([
        getForecast(token, normalised),
        getForecastHistory(token, normalised, undefined, 30),
      ])

      if (res.status === 'fulfilled') {
        setResult(res.value)
        setActiveHorizon('day')
      } else {
        const msg = (res.reason as Error).message
        try {
          const body = JSON.parse(msg)
          setError(body.detail ?? msg)
        } catch {
          setError(msg)
        }
      }

      if (hist.status === 'fulfilled') setHistory(hist.value)
    } finally {
      setLoading(false)
    }
  }

  const activeHF = result?.forecasts.find(f => f.horizon === activeHorizon) ?? null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Forecast" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Price Forecast</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            ML ensemble (Random Forest · Gradient Boost · Ridge) + Claude agent analysis · Day / Week / Month horizons
          </p>
        </div>

        {/* Search */}
        <div className="flex gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyse()}
            placeholder="Enter symbol, e.g. RELIANCE or TCS.NS"
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <button
            onClick={analyse}
            disabled={loading || !query.trim()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading
              ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Analysing…</>
              : '⚡ Analyse'
            }
          </button>
        </div>

        {loading && (
          <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 dark:border-indigo-800 dark:bg-indigo-950/30">
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              Training 3 ML models on 2 years of market data…
            </p>
            <p className="mt-1 text-xs text-indigo-500 dark:text-indigo-400">
              RandomForest · Gradient Boost · Ridge Regression — computing day, week & month forecasts (~10–20 seconds)
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:border-red-800 dark:bg-red-950/30">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Forecast failed</p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {result && (
          <>
            {/* Price strip */}
            <div className="mt-6 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{result.symbol}</p>
                  <h2 className="mt-0.5 text-lg font-bold text-zinc-900 dark:text-zinc-50">{result.name}</h2>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                    ₹{fmt(result.current_price)}
                  </p>
                  <p className={`text-sm font-medium ${result.day_change_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {result.day_change_pct >= 0 ? '▲' : '▼'} {Math.abs(result.day_change_pct).toFixed(2)}% today
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                {[
                  ['Prev Close',   `₹${fmt(result.prev_close)}`],
                  ['Week',         `${result.week_change_pct >= 0 ? '+' : ''}${result.week_change_pct.toFixed(2)}%`],
                  ['52w High',     `₹${fmt(result.high_52w)}`],
                  ['52w Low',      `₹${fmt(result.low_52w)}`],
                  ['Avg Volume',   fmtVol(result.avg_volume)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{label}</p>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Horizon tabs + cards */}
            <div className="mt-6">
              <div className="mb-4 flex gap-2">
                {(['day', 'week', 'month'] as const).map(h => (
                  <button
                    key={h}
                    onClick={() => setActiveHorizon(h)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      activeHorizon === h
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {h === 'day' ? 'Tomorrow' : h === 'week' ? '1 Week' : '1 Month'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {result.forecasts.map(f => (
                  <button key={f.horizon} onClick={() => setActiveHorizon(f.horizon as 'day' | 'week' | 'month')} className="text-left">
                    <HorizonCard hf={f} active={activeHorizon === f.horizon} />
                  </button>
                ))}
              </div>

              {/* Model breakdown for active horizon */}
              {activeHF && (
                <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Model Breakdown — {activeHorizon === 'day' ? 'Tomorrow' : activeHorizon === 'week' ? '1 Week' : '1 Month'}
                  </h3>
                  <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
                    Each model trained independently on 2 years of daily OHLCV + 14 technical features
                  </p>
                  <ModelTable models={activeHF.models} basePrice={result.current_price} />
                </div>
              )}
            </div>

            {/* Claude agent analysis */}
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800/50 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-base">✦</span>
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">AI Agent Analysis</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
                  Claude {result.agent_analysis.startsWith('AI agent analysis') ? '· unavailable' : '· Haiku'}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                {result.agent_analysis}
              </p>
            </div>

            {/* Accuracy history */}
            <div className="mt-8">
              <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Prediction Accuracy History
              </h3>
              <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">
                Predictions resolve automatically at 16:30 IST each trading day. Error % = |predicted − actual| / actual.
              </p>
              <AccuracyTable records={history} />
            </div>
          </>
        )}

        {!result && !loading && !error && (
          <div className="mt-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-3xl dark:bg-indigo-950">
              📈
            </div>
            <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Enter any NSE/BSE symbol</h2>
            <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
              e.g. RELIANCE, TCS, INFY, NIFTY50.NS — get day, week &amp; month price targets with model confidence
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

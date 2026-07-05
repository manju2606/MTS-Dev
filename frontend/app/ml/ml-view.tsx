'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { predictBatch, getWatchlist, getForecast, searchStocks } from '@/lib/api'
import type { MLPrediction, ForecastResult, HorizonForecast, WatchlistItem, StockSearchResult } from '@/lib/api'

type Tab = 'direction' | 'forecast'

// ── Direction card ────────────────────────────────────────────────────────────

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

// ── Horizon row ───────────────────────────────────────────────────────────────

function HorizonRow({ h }: { h: HorizonForecast }) {
  const isUp = h.direction === 'UP'
  const isFlat = h.direction === 'FLAT'
  const dirColor = isUp ? 'text-emerald-600 dark:text-emerald-400' : isFlat ? 'text-zinc-400' : 'text-red-500 dark:text-red-400'
  const dirIcon = isUp ? '▲' : isFlat ? '→' : '▼'

  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold capitalize text-zinc-900 dark:text-zinc-50">{h.horizon}</p>
          <p className="text-[10px] text-zinc-400">Target: {h.target_date} ({h.horizon_days}d)</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold ${dirColor}`}>{dirIcon} ₹{h.ensemble_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          <p className={`text-xs font-semibold ${dirColor}`}>{h.ensemble_change_pct > 0 ? '+' : ''}{h.ensemble_change_pct.toFixed(2)}%</p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-[10px] text-zinc-400">
        <span>Band:</span>
        <span className="text-red-400">₹{h.lower_bound.toFixed(0)}</span>
        <span>—</span>
        <span className="text-emerald-500">₹{h.upper_bound.toFixed(0)}</span>
      </div>

      <div className="flex flex-col gap-1">
        {h.models.map(m => {
          const mDir = m.direction === 'UP'
          return (
            <div key={m.model} className="flex items-center justify-between text-xs">
              <span className="capitalize text-zinc-500">{m.model.replace('_', ' ')}</span>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${mDir ? 'text-emerald-600 dark:text-emerald-400' : m.direction === 'FLAT' ? 'text-zinc-400' : 'text-red-500 dark:text-red-400'}`}>
                  ₹{m.predicted_price.toFixed(0)} ({m.change_pct > 0 ? '+' : ''}{m.change_pct.toFixed(1)}%)
                </span>
                <span className="text-zinc-400">{Math.round(m.confidence * 100)}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Forecast card ─────────────────────────────────────────────────────────────

function ForecastCard({ result }: { result: ForecastResult }) {
  const sym = result.symbol.replace(/\.(NS|BO)$/, '')
  const dayChange = result.day_change_pct
  const changeColor = dayChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{sym}</p>
          <p className="text-xs text-zinc-400">{result.name}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            ₹{result.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
          <p className={`text-xs font-semibold ${changeColor}`}>
            {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)}% today
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px border-b border-zinc-100 dark:border-zinc-800">
        {[
          { label: '52W High', value: `₹${result.high_52w.toLocaleString('en-IN')}` },
          { label: '52W Low',  value: `₹${result.low_52w.toLocaleString('en-IN')}` },
          { label: 'Vol', value: (result.volume / 1e5).toFixed(1) + 'L' },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3 text-center">
            <p className="text-[10px] text-zinc-400">{label}</p>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{value}</p>
          </div>
        ))}
      </div>

      {/* Horizon forecasts */}
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        {result.forecasts.map(h => <HorizonRow key={h.horizon} h={h} />)}
      </div>

      {/* Agent analysis */}
      {result.agent_analysis && (
        <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">AI Analysis</p>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{result.agent_analysis}</p>
        </div>
      )}
    </div>
  )
}

// ── Forecast tab ──────────────────────────────────────────────────────────────

function ForecastTab({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [symbol, setSymbol] = useState('')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return }
    const id = setTimeout(async () => {
      try {
        const { searchStocks } = await import('@/lib/api')
        setSuggestions(await searchStocks(tokenRef.current, query))
      } catch { setSuggestions([]) }
    }, 300)
    return () => clearTimeout(id)
  }, [query, tokenRef])

  async function runForecast(sym: string) {
    if (!sym.trim()) return
    setLoading(true); setError(null); setResult(null); setSuggestions([])
    try {
      const r = await getForecast(tokenRef.current, sym.trim())
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forecast failed')
    } finally { setLoading(false) }
  }

  function select(s: StockSearchResult) {
    setQuery(s.name + ' (' + s.symbol.replace(/\.(NS|BO)$/, '') + ')')
    setSymbol(s.symbol)
    setSuggestions([])
  }

  return (
    <div>
      <p className="mb-4 text-xs text-zinc-400">
        Ensemble of RandomForest, Gradient Boosting, and Ridge regression. 3 horizons: day, week, month.
      </p>

      <div className="relative mb-6 flex gap-2">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setSymbol('') }}
            onKeyDown={e => e.key === 'Enter' && runForecast(symbol || query)}
            placeholder="Search symbol (e.g. RELIANCE, TCS)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {suggestions.slice(0, 8).map(s => (
                <button
                  key={s.symbol}
                  onClick={() => select(s)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{s.symbol.replace(/\.(NS|BO)$/, '')}</span>
                  <span className="text-zinc-400 truncate max-w-[200px]">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => runForecast(symbol || query)}
          disabled={loading || (!symbol && !query)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {loading ? 'Forecasting…' : 'Forecast'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="h-5 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            {[0, 1, 2].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />)}
          </div>
        </div>
      )}

      {!loading && result && <ForecastCard result={result} />}

      {!loading && !result && !error && (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Search for a symbol and click <strong>Forecast</strong>.</p>
          <p className="mt-1 text-xs text-zinc-400">Trains 3 ML models on 2 years of data to generate day/week/month price targets.</p>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function MLView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [tab, setTab] = useState<Tab>('direction')
  const [preds, setPreds] = useState<MLPrediction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const id = setTimeout(() => setAuthChecked(true), 0)
    return () => clearTimeout(id)
  }, [router])

  const runAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const wl = await getWatchlist(tokenRef.current)
      if (!wl.length) { setError('Watchlist is empty — add symbols on the dashboard first.'); return }
      const results = await predictBatch(tokenRef.current, wl.map((i: WatchlistItem) => i.symbol))
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
              Machine learning models trained on 2 years of Indian market data.
              {tab === 'direction' && preds.length > 0 && ` ${upCount} UP · ${downCount} DOWN`}
            </p>
          </div>
          {tab === 'direction' && (
            <button
              onClick={runAll}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Training & predicting…' : 'Run All'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex border-b border-zinc-200 dark:border-zinc-800">
          {([
            { key: 'direction', label: 'Direction (Next Day)' },
            { key: 'forecast',  label: 'Price Forecast (Day / Week / Month)' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`mr-6 border-b-2 pb-3 text-sm font-semibold transition-colors ${
                tab === key
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Direction tab */}
        {tab === 'direction' && (
          <>
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
          </>
        )}

        {/* Forecast tab */}
        {tab === 'forecast' && <ForecastTab tokenRef={tokenRef} />}
      </main>
    </div>
  )
}

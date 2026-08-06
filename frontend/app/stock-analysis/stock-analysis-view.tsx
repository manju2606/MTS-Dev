'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import type { PredictionPoint, RefLine } from '@/components/price-chart'
import {
  searchStocks, analyzeSymbol, getForecast, getStockAnalysisPrediction, getMe,
} from '@/lib/api'
import type {
  StockSearchResult, AIRecommendation, ForecastResult, HorizonForecast, GoldenEggPrediction, ChartPeriod,
} from '@/lib/api'

const PREDICTION_PERIODS: ChartPeriod[] = ['5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M']

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const SIGNAL_CLS: Record<string, string> = {
  BUY: 'bg-emerald-600 text-white',
  SELL: 'bg-red-600 text-white',
  HOLD: 'bg-zinc-400 text-white',
}

// ── Stock search (same pattern as the TradingView page) ─────────────────────

function StockSearch({ token, onSelect }: { token: string; onSelect: (r: StockSearchResult) => void }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(val: string) {
    setQuery(val)
    if (searchRef.current) clearTimeout(searchRef.current)
    if (val.trim().length < 2) { setSuggestions([]); return }
    searchRef.current = setTimeout(() => {
      searchStocks(token, val).then(setSuggestions)
    }, 250)
  }

  function handlePick(r: StockSearchResult) {
    setQuery(`${r.symbol.replace('.NS', '').replace('.BO', '')} — ${r.name}`)
    setSuggestions([])
    onSelect(r)
  }

  return (
    <div className="relative w-full max-w-md">
      <input
        value={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search a stock (e.g. INFY, Reliance…)"
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {suggestions.map(r => (
            <li key={r.symbol}>
              <button type="button" onClick={() => handlePick(r)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {r.symbol.replace('.NS', '').replace('.BO', '')}
                </span>
                <span className="ml-2 truncate text-zinc-400">{r.name}</span>
                <span className="ml-2 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{r.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function HorizonCard({ f }: { f: HorizonForecast }) {
  const up = f.direction === 'UP'
  const flat = f.direction === 'FLAT'
  const color = flat ? 'text-zinc-500' : up ? 'text-emerald-600' : 'text-red-500'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        {f.horizon} ({f.horizon_days}d) &middot; {f.target_date}
      </p>
      <p className={`text-lg font-bold ${color}`}>₹{fmt(f.ensemble_price)}</p>
      <p className={`text-xs font-semibold ${color}`}>
        {f.ensemble_change_pct >= 0 ? '+' : ''}{f.ensemble_change_pct.toFixed(2)}% &middot; {f.direction}
      </p>
      <p className="mt-1 text-[10px] text-zinc-400">
        Range ₹{fmt(f.lower_bound)} – ₹{fmt(f.upper_bound)}
      </p>
    </div>
  )
}

// ── Prediction chart -- same pattern as Golden Egg's, keyed by whatever
// symbol is currently searched instead of a fixed daily pick ────────────────

function PredictionChart({ token, symbol, rec }: { token: string; symbol: string; rec: AIRecommendation | null }) {
  const [period, setPeriod] = useState<ChartPeriod>('1h')
  const [pred, setPred] = useState<GoldenEggPrediction | null>(null)

  useEffect(() => {
    setPred(null)
    getStockAnalysisPrediction(token, symbol, period).then(setPred).catch(() => null)
  }, [token, symbol, period])

  if (!pred) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        Loading forecast…
      </div>
    )
  }
  if (pred.note) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        {pred.note}
      </div>
    )
  }
  const acc = pred.accuracy

  const predictionPoints: PredictionPoint[] = Array.from(
    [...pred.history, ...pred.predicted]
      .reduce((map, p) => {
        map.set(p.time, { time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower })
        return map
      }, new Map<number, PredictionPoint>())
      .values(),
  ).sort((a, b) => a.time - b.time)

  const refLines: RefLine[] = [
    ...(pred.day_high != null ? [{ price: pred.day_high, label: 'DH', color: '#10b981' }] : []),
    ...(pred.day_low != null ? [{ price: pred.day_low, label: 'DL', color: '#10b981' }] : []),
    ...(pred.week_high != null ? [{ price: pred.week_high, label: 'WH', color: '#3b82f6' }] : []),
    ...(pred.week_low != null ? [{ price: pred.week_low, label: 'WL', color: '#3b82f6' }] : []),
    ...(pred.month_high != null ? [{ price: pred.month_high, label: 'MH', color: '#ef4444' }] : []),
    ...(pred.month_low != null ? [{ price: pred.month_low, label: 'ML', color: '#ef4444' }] : []),
  ]

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        AI forecast (local heuristic — not a trading signal) &middot; DH/DL = day, WH/WL = week, MH/ML = month high/low
      </p>
      <PriceChart
        symbol={symbol}
        data={pred.candles}
        period={period}
        onPeriodChange={setPeriod}
        loading={false}
        currentPrice={pred.last_actual_close ?? null}
        prediction={predictionPoints}
        refLines={refLines}
        periods={PREDICTION_PERIODS}
        showVolume
        aiLevels={rec && rec.signal !== 'HOLD' ? {
          signal: rec.signal, entry: rec.entry_price, stopLoss: rec.stop_loss, target: rec.target,
        } : null}
      />
      {acc.sample_size > 0 && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Tracked {acc.sample_size} past predictions &middot; {acc.hit_rate_pct?.toFixed(1)}% landed within band
          {acc.avg_error_pct != null && <> &middot; avg error {acc.avg_error_pct.toFixed(2)}%</>}
        </p>
      )}
    </div>
  )
}

export default function StockAnalysisView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<StockSearchResult | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setToken(t)
    getMe(t).catch(() => null)
    const id = setTimeout(() => setAuthChecked(true), 0)
    return () => clearTimeout(id)
  }, [router])

  function handleSelect(r: StockSearchResult) {
    setSelected(r)
    setRec(null)
    setForecast(null)
    setError('')
    analyzeSymbol(token, r.symbol).then(setRec).catch(() => {})
    getForecast(token, r.symbol).then(setForecast).catch(e => setError((e as Error).message))
  }

  if (!authChecked) return null

  const sym = selected?.symbol.replace('.NS', '').replace('.BO', '') ?? ''
  const dayF = forecast?.forecasts.find(f => f.horizon === 'day')
  const weekF = forecast?.forecasts.find(f => f.horizon === 'week')
  const monthF = forecast?.forecasts.find(f => f.horizon === 'month')

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Stock Analysis" />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">🔍 Stock Analysis</h1>
        <p className="mb-6 text-xs text-zinc-400">
          Search any stock for its AI signal, multi-timeframe forecast, and day/week/month ML prediction — the same view Golden Egg shows for its daily pick, for whatever stock you choose.
        </p>

        <div className="mb-6">
          <StockSearch token={token} onSelect={handleSelect} />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {!selected && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white py-20 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 text-5xl">🔍</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">Search for a stock to analyze</h3>
            <p className="text-sm text-zinc-500">AI signal, chart with volume + predictions, and day/week/month forecast will appear here.</p>
          </div>
        )}

        {selected && (
          <>
            <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{sym}</span>
                <span className="text-xs text-zinc-400">{selected.name} &middot; {selected.sector}</span>
              </div>

              {rec ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${SIGNAL_CLS[rec.signal]}`}>{rec.signal}</span>
                    <span className="text-xs text-zinc-400">Confidence {(rec.confidence * 100).toFixed(0)}%</span>
                    <span className="text-xs text-zinc-400">R:R {rec.risk_reward_ratio.toFixed(2)}</span>
                    <span className="text-xs text-zinc-400">Holding {rec.holding_period}</span>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
                      <p className="text-[10px] text-zinc-400">Entry</p>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">₹{fmt(rec.entry_price)}</p>
                    </div>
                    <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
                      <p className="text-[10px] text-zinc-400">Stop Loss</p>
                      <p className="font-semibold text-red-600 dark:text-red-400">₹{fmt(rec.stop_loss)}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
                      <p className="text-[10px] text-zinc-400">Target</p>
                      <p className="font-semibold text-emerald-600 dark:text-emerald-400">₹{fmt(rec.target)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{rec.explanation}</p>
                </>
              ) : (
                <p className="text-xs text-zinc-400">Loading AI signal…</p>
              )}
            </div>

            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Predictions</p>
            <div className="mb-3">
              <PredictionChart token={token} symbol={selected.symbol} rec={rec} />
            </div>
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {dayF && <HorizonCard f={dayF} />}
              {weekF && <HorizonCard f={weekF} />}
              {monthF && <HorizonCard f={monthF} />}
            </div>
            {forecast?.agent_analysis && (
              <p className="mb-8 -mt-4 text-xs text-zinc-500 dark:text-zinc-400">{forecast.agent_analysis}</p>
            )}
          </>
        )}
      </main>
    </div>
  )
}

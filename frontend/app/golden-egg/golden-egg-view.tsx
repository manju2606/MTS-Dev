'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { PriceChart } from '@/components/price-chart'
import type { PredictionPoint, RefLine } from '@/components/price-chart'
import {
  getGoldenEggToday, getGoldenEggById, getGoldenEggHistory, triggerGoldenEggScan, getGoldenEggPrediction,
  getForecast, getMe,
} from '@/lib/api'
import type {
  GoldenEggPick, GoldenEggHistoryItem, GoldenEggPrediction, ForecastResult, HorizonForecast, ChartPeriod,
} from '@/lib/api'

const PREDICTION_PERIODS: ChartPeriod[] = ['5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M']

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateTime(iso: string | undefined) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
  } catch {
    return iso
  }
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 70 ? '#059669' : score >= 50 ? '#f59e0b' : '#dc2626'
  const pct = Math.min(100, score)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="min-w-[2.5rem] text-right text-sm font-bold" style={{ color }}>{score}</span>
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

type TradeLevels = { entry: number; stopLoss: number; target1: number; target2: number }

function PredictionChart({ token, symbol, viewingId, levels }: { token: string; symbol: string; viewingId: string | null; levels: TradeLevels }) {
  const [period, setPeriod] = useState<ChartPeriod>('1h')
  const [pred, setPred] = useState<GoldenEggPrediction | null>(null)

  useEffect(() => {
    setPred(null)
    getGoldenEggPrediction(token, period, viewingId ?? undefined).then(setPred).catch(() => null)
  }, [token, period, viewingId, symbol])

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

  // Merge the persisted trail (past predictions, kept on the chart even
  // once resolved) with the current forward forecast, de-duplicated by
  // time -- same approach as the MCX AI Score page's chart.
  const predictionPoints: PredictionPoint[] = Array.from(
    [...pred.history, ...pred.predicted]
      .reduce((map, p) => {
        map.set(p.time, { time: p.time, predictedClose: p.predicted_close, upper: p.upper, lower: p.lower })
        return map
      }, new Map<number, PredictionPoint>())
      .values(),
  ).sort((a, b) => a.time - b.time)

  const refLines: RefLine[] = [
    { price: levels.entry, label: 'Entry', color: '#6366f1' },
    { price: levels.stopLoss, label: 'SL', color: '#dc2626' },
    { price: levels.target1, label: 'T1', color: '#059669' },
    { price: levels.target2, label: 'T2', color: '#059669' },
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
        AI forecast (local heuristic — not a trading signal) &middot; DH/DL = day, WH/WL = week, MH/ML = month high/low &middot; SL/T1/T2 = stop-loss/targets
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

export default function GoldenEggView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingId = searchParams.get('id')
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [today, setToday] = useState<GoldenEggPick | null>(null)
  const [history, setHistory] = useState<GoldenEggHistoryItem[]>([])
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getMe(t).then(u => setIsAdmin(u.role === 'admin')).catch(() => null)

    getGoldenEggHistory(t, 30).then(setHistory).catch(() => null)
    setLoading(true)
    const fetchPick = viewingId ? getGoldenEggById(t, viewingId) : getGoldenEggToday(t)
    fetchPick
      .then(async doc => {
        setToday(doc)
        if (doc.pick) {
          getForecast(t, doc.pick.symbol).then(setForecast).catch(() => null)
        }
      })
      .catch(() => setToday(null))
      .finally(() => setLoading(false))

    const id = setTimeout(() => setAuthChecked(true), 0)
    return () => clearTimeout(id)
  }, [router, viewingId])

  async function handleScan() {
    setScanning(true); setMsg(null)
    try {
      await triggerGoldenEggScan(tokenRef.current)
      const [doc, hist] = await Promise.all([
        getGoldenEggToday(tokenRef.current),
        getGoldenEggHistory(tokenRef.current, 30),
      ])
      setToday(doc); setHistory(hist)
      if (doc.pick) {
        getForecast(tokenRef.current, doc.pick.symbol).then(setForecast).catch(() => null)
      }
      setMsg('Scan complete.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Scan failed')
    } finally { setScanning(false) }
  }

  if (!authChecked) return null

  const pick = today?.pick ?? null
  const sym = pick?.symbol.replace('.NS', '').replace('.BO', '') ?? ''
  const dayF = forecast?.forecasts.find(f => f.horizon === 'day')
  const weekF = forecast?.forecasts.find(f => f.horizon === 'week')
  const monthF = forecast?.forecasts.find(f => f.horizon === 'month')

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Golden Egg" />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">🥚 Golden Egg — Stock of the Day</h1>
            <p className="text-xs text-zinc-400">
              One high-conviction intraday pick, emailed 09:15–09:30 IST every trading day. History and predictions below.
            </p>
          </div>
          {isAdmin && !viewingId && (
            <button
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Run scan now'}
            </button>
          )}
        </div>

        {viewingId && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            <span>Viewing a historical pick{today ? ` from ${today.scan_date}` : ''}, not today's.</span>
            <Link href="/golden-egg" className="font-semibold underline hover:no-underline">
              ← Back to today
            </Link>
          </div>
        )}

        {msg && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {msg}
          </div>
        )}

        {loading && <p className="text-sm text-zinc-400">Loading…</p>}

        {!loading && !pick && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              {today ? "No clear setup on the scanner's last run." : 'No Golden Egg pick yet.'}
            </p>
          </div>
        )}

        {!loading && pick && (
          <>
            <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{sym}</span>
                  <span className={`text-sm font-semibold ${pick.change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {pick.change_pct >= 0 ? '+' : ''}{pick.change_pct.toFixed(2)}%
                  </span>
                  <span className="text-xs text-zinc-400">{pick.sector}</span>
                  <span className="text-xs text-zinc-400">&middot; {today?.scan_date}</span>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-zinc-400">LTP</p>
                  <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                    ₹{fmt(pick.ltp ?? pick.current_price)}
                  </p>
                  {pick.pnl_amount != null && pick.pnl_pct != null && (
                    <p className={`text-xs font-semibold ${pick.pnl_amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pick.pnl_amount >= 0 ? '+' : ''}₹{fmt(pick.pnl_amount)} ({pick.pnl_pct >= 0 ? '+' : ''}{pick.pnl_pct.toFixed(2)}%)
                    </p>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <ConfidenceBar score={pick.confidence_score} />
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
                  <p className="text-[10px] text-zinc-400">Entry</p>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">₹{fmt(pick.entry_price)}</p>
                </div>
                <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
                  <p className="text-[10px] text-zinc-400">Stop Loss</p>
                  <p className="font-semibold text-red-600 dark:text-red-400">₹{fmt(pick.stop_loss)}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
                  <p className="text-[10px] text-zinc-400">Target 1</p>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">₹{fmt(pick.target_1)}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
                  <p className="text-[10px] text-zinc-400">Target 2</p>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">₹{fmt(pick.target_2)}</p>
                </div>
              </div>

              {today?.sizing && (
                <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Suggested qty <span className="font-semibold">{today.sizing.qty}</span> for ~₹{fmt(today.sizing.expected_profit)} at T1
                  (position ₹{fmt(today.sizing.position_value)}, max loss ₹{fmt(today.sizing.max_loss)})
                  {today.sizing.capped ? ' — capped to paper capital' : ''}
                </p>
              )}

              {pick.reasons?.length > 0 && (
                <ul className="mb-2 list-inside list-disc space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {pick.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}

              {today?.market_context && (
                <p className="text-xs text-zinc-400">Market context: {today.market_context}</p>
              )}
            </div>

            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Predictions</p>
            <div className="mb-3">
              <PredictionChart
                token={tokenRef.current}
                symbol={pick.symbol}
                viewingId={viewingId}
                levels={{ entry: pick.entry_price, stopLoss: pick.stop_loss, target1: pick.target_1, target2: pick.target_2 }}
              />
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

        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">History</p>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-400 dark:border-zinc-800">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Symbol</th>
                <th className="px-3 py-2 font-semibold">Entry</th>
                <th className="px-3 py-2 font-semibold">LTP</th>
                <th className="px-3 py-2 font-semibold">P&amp;L</th>
                <th className="px-3 py-2 font-semibold">Confidence</th>
                <th className="px-3 py-2 font-semibold">Generated</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-400">No history yet.</td></tr>
              )}
              {history.map(h => (
                <tr key={h.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 text-zinc-500">{h.scan_date}</td>
                  <td className="px-3 py-2 font-semibold">
                    {h.pick ? (
                      <Link href={`/golden-egg?id=${h.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {h.pick.symbol.replace('.NS', '').replace('.BO', '')}
                      </Link>
                    ) : (
                      <span className="text-zinc-900 dark:text-zinc-100">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{h.pick ? `₹${fmt(h.pick.entry_price)}` : '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">
                    {h.pick?.ltp != null ? `₹${fmt(h.pick.ltp)}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {h.pick?.pnl_amount != null && h.pick?.pnl_pct != null ? (
                      <span className={`font-semibold ${h.pick.pnl_amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {h.pick.pnl_amount >= 0 ? '+' : ''}₹{fmt(h.pick.pnl_amount)} ({h.pick.pnl_pct >= 0 ? '+' : ''}{h.pick.pnl_pct.toFixed(2)}%)
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{h.pick ? h.pick.confidence_score : '—'}</td>
                  <td className="px-3 py-2 text-zinc-400">{fmtDateTime(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

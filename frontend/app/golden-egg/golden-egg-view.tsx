'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getGoldenEggToday, getGoldenEggHistory, triggerGoldenEggScan, getGoldenEgg1hPrediction,
  getForecast, getMe,
} from '@/lib/api'
import type {
  GoldenEggPick, GoldenEggHistoryItem, GoldenEgg1hPrediction, ForecastResult, HorizonForecast,
} from '@/lib/api'

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

function fmtHour(epoch: number) {
  return new Date(epoch * 1000).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
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

function OneHourCard({ pred }: { pred: GoldenEgg1hPrediction | null }) {
  if (!pred) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        Loading 1h forecast…
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
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        Next hours (local heuristic — not a trading signal)
      </p>
      <div className="space-y-1">
        {pred.predicted.map(p => (
          <div key={p.time} className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">{fmtHour(p.time)}</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">₹{fmt(p.predicted_close)}</span>
            <span className="text-[10px] text-zinc-400">₹{fmt(p.lower)}–₹{fmt(p.upper)}</span>
          </div>
        ))}
      </div>
      {acc.sample_size > 0 && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Tracked {acc.sample_size} past predictions &middot; {acc.hit_rate_pct?.toFixed(1)}% landed within band
        </p>
      )}
    </div>
  )
}

export default function GoldenEggView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [today, setToday] = useState<GoldenEggPick | null>(null)
  const [history, setHistory] = useState<GoldenEggHistoryItem[]>([])
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [oneHour, setOneHour] = useState<GoldenEgg1hPrediction | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getMe(t).then(u => setIsAdmin(u.role === 'admin')).catch(() => null)

    getGoldenEggHistory(t, 30).then(setHistory).catch(() => null)
    getGoldenEggToday(t)
      .then(async doc => {
        setToday(doc)
        if (doc.pick) {
          getGoldenEgg1hPrediction(t).then(setOneHour).catch(() => null)
          getForecast(t, doc.pick.symbol).then(setForecast).catch(() => null)
        }
      })
      .catch(() => setToday(null))
      .finally(() => setLoading(false))

    const id = setTimeout(() => setAuthChecked(true), 0)
    return () => clearTimeout(id)
  }, [router])

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
        getGoldenEgg1hPrediction(tokenRef.current).then(setOneHour).catch(() => null)
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
          {isAdmin && (
            <button
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Run scan now'}
            </button>
          )}
        </div>

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
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{sym}</span>
                <span className={`text-sm font-semibold ${pick.change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {pick.change_pct >= 0 ? '+' : ''}{pick.change_pct.toFixed(2)}%
                </span>
                <span className="text-xs text-zinc-400">{pick.sector}</span>
                <span className="text-xs text-zinc-400">&middot; {today?.scan_date}</span>
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
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OneHourCard pred={oneHour} />
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
                <th className="px-3 py-2 font-semibold">Confidence</th>
                <th className="px-3 py-2 font-semibold">Generated</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-400">No history yet.</td></tr>
              )}
              {history.map(h => (
                <tr key={h.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-3 py-2 text-zinc-500">{h.scan_date}</td>
                  <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    {h.pick ? h.pick.symbol.replace('.NS', '').replace('.BO', '') : '—'}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{h.pick ? `₹${fmt(h.pick.entry_price)}` : '—'}</td>
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

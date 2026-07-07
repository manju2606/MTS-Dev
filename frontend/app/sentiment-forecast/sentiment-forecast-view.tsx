'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getCurrentWeekSentimentForecast, getSentimentForecastHistory,
  generateSentimentForecast, triggerSentimentSnapshot,
} from '@/lib/api'
import type { WeeklySentimentForecast } from '@/lib/api'

const LABEL_STYLES: Record<string, string> = {
  Bullish:              'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  'Cautiously Bullish':  'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  Neutral:              'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  Cautious:             'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  Bearish:              'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
}

function LabelChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${LABEL_STYLES[label] ?? LABEL_STYLES.Neutral}`}>
      {label}
    </span>
  )
}

function DayCard({ day, isToday }: { day: WeeklySentimentForecast['days'][number]; isToday: boolean }) {
  const resolved = day.actual_label !== null
  return (
    <div className={`rounded-xl border p-4 ${isToday ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400">{day.weekday}</p>
        <p className="text-[10px] text-zinc-400">{day.date}</p>
      </div>

      <div className="mb-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Forecast</p>
        <div className="flex items-center justify-between">
          <LabelChip label={day.forecast_label} />
          <span className="font-mono text-sm font-bold text-zinc-700 dark:text-zinc-200">
            {day.forecast_bull_pct.toFixed(0)}% bull
          </span>
        </div>
      </div>

      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Actual</p>
        {resolved ? (
          <div className="flex items-center justify-between">
            <LabelChip label={day.actual_label} />
            <span className="font-mono text-sm font-bold text-zinc-700 dark:text-zinc-200">
              {day.actual_bull_pct!.toFixed(0)}% bull
            </span>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">{isToday ? 'Pending (after market close)' : 'Not yet reached'}</p>
        )}
      </div>

      {resolved && (
        <div className={`mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
          day.label_match ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
        }`}>
          {day.label_match ? '✓ Forecast matched' : '✗ Forecast missed'}
          <span className="ml-auto font-mono opacity-75">±{day.error_pct?.toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}

function AccuracyBar({ forecast }: { forecast: WeeklySentimentForecast }) {
  const { accuracy } = forecast
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">This Week&apos;s Accuracy</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[10px] text-zinc-400">Days Tracked</p>
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{accuracy.days_resolved} / 5</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Days Correct</p>
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{accuracy.days_correct}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Accuracy</p>
          <p className={`text-lg font-bold ${accuracy.accuracy_pct !== null && accuracy.accuracy_pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {accuracy.accuracy_pct !== null ? `${accuracy.accuracy_pct}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400">Avg Error</p>
          <p className="text-lg font-bold text-zinc-700 dark:text-zinc-200">
            {accuracy.avg_error_pct !== null ? `±${accuracy.avg_error_pct}%` : '—'}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400 dark:border-zinc-800">
        Forecast inputs: 3-day avg bull % {forecast.inputs.avg_bull_pct_3d.toFixed(1)}%
        {forecast.inputs.vix_value !== null && <> · India VIX {forecast.inputs.vix_value.toFixed(1)} (adj {forecast.inputs.vix_adjustment >= 0 ? '+' : ''}{forecast.inputs.vix_adjustment.toFixed(1)})</>}
        {' '}· Nifty momentum {forecast.inputs.nifty_momentum_pct >= 0 ? '+' : ''}{forecast.inputs.nifty_momentum_pct.toFixed(1)}% (adj {forecast.inputs.nifty_adjustment >= 0 ? '+' : ''}{forecast.inputs.nifty_adjustment.toFixed(1)})
      </div>
    </div>
  )
}

function HistoryTable({ history }: { history: WeeklySentimentForecast[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-400">No past weeks tracked yet.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Week Of', 'Forecast', 'Days Tracked', 'Days Correct', 'Accuracy', 'Avg Error'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-zinc-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
          {history.map(w => (
            <tr key={w.week_start}>
              <td className="px-3 py-2.5 font-medium text-zinc-700 dark:text-zinc-200">{w.week_start}</td>
              <td className="px-3 py-2.5"><LabelChip label={w.days[0]?.forecast_label ?? null} /></td>
              <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{w.accuracy.days_resolved} / 5</td>
              <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{w.accuracy.days_correct}</td>
              <td className="px-3 py-2.5 font-semibold">
                {w.accuracy.accuracy_pct !== null ? (
                  <span className={w.accuracy.accuracy_pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
                    {w.accuracy.accuracy_pct}%
                  </span>
                ) : <span className="text-zinc-300">—</span>}
              </td>
              <td className="px-3 py-2.5 text-zinc-500">
                {w.accuracy.avg_error_pct !== null ? `±${w.accuracy.avg_error_pct}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SentimentForecastView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [userRole, setUserRole] = useState('')
  const [forecast, setForecast] = useState<WeeklySentimentForecast | null>(null)
  const [history, setHistory] = useState<WeeklySentimentForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'generate' | 'snapshot' | null>(null)

  const isAdmin = userRole === 'admin'
  const today = new Date().toISOString().slice(0, 10)

  async function load(token: string) {
    setLoading(true)
    setError(null)
    try {
      const [f, h] = await Promise.all([
        getCurrentWeekSentimentForecast(token),
        getSentimentForecastHistory(token, 12),
      ])
      setForecast(f)
      setHistory(h)
      if (!f) setError('No forecast generated for this week yet.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('mts_token')
    if (!token) { router.replace('/login'); return }
    tokenRef.current = token
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      setUserRole(payload.role ?? '')
    } catch {
      setUserRole('')
    }
    load(token)
  }, [router])

  async function handleGenerate() {
    setBusy('generate')
    try {
      await generateSentimentForecast(tokenRef.current)
      await load(tokenRef.current)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to generate forecast')
    } finally {
      setBusy(null)
    }
  }

  async function handleSnapshot() {
    setBusy('snapshot')
    try {
      await triggerSentimentSnapshot(tokenRef.current)
      await load(tokenRef.current)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to capture snapshot')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Sentiment Forecast" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Market Sentiment Forecast</h1>
            <p className="text-xs text-zinc-400">
              A transparent, rule-based week-ahead projection of NSE market breadth — generated every
              Monday from the recent bull/bear trend, India VIX, and Nifty momentum — tracked daily
              against what actually happens.
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={handleSnapshot}
                disabled={busy !== null}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {busy === 'snapshot' ? 'Capturing…' : 'Capture Today’s Snapshot'}
              </button>
              <button
                onClick={handleGenerate}
                disabled={busy !== null}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {busy === 'generate' ? 'Generating…' : 'Generate This Week’s Forecast'}
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        ) : !forecast ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-500">{error ?? 'No forecast available.'}</p>
            {isAdmin && (
              <p className="mt-1 text-xs text-zinc-400">Click &quot;Generate This Week&apos;s Forecast&quot; to create one now.</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {forecast.days.map(day => (
                <DayCard key={day.date} day={day} isToday={day.date === today} />
              ))}
            </div>

            <AccuracyBar forecast={forecast} />

            <div>
              <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Past Weeks</p>
              <HistoryTable history={history.filter(w => w.week_start !== forecast.week_start)} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

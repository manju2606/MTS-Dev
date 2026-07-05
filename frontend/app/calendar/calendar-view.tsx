'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getCalendarEvents } from '@/lib/api'
import type { CalendarEvent } from '@/lib/api'

const TYPE_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  fo_expiry:      { label: 'F&O Expiry',     dot: 'bg-red-500',     badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
  weekly_expiry:  { label: 'Weekly Expiry',  dot: 'bg-orange-400',  badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  central_bank:   { label: 'RBI Policy',     dot: 'bg-indigo-600',  badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' },
  market_holiday: { label: 'Holiday',        dot: 'bg-zinc-400',    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
  earnings:       { label: 'Earnings',        dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
}

const IMPACT_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  info:   'bg-zinc-300',
}

function EventCard({ event }: { event: CalendarEvent }) {
  const cfg = TYPE_CONFIG[event.type] ?? { label: event.type, dot: 'bg-zinc-400', badge: 'bg-zinc-100 text-zinc-600' }
  const d = new Date(event.date + 'T00:00:00')
  const dayName = d.toLocaleDateString('en-IN', { weekday: 'short' })
  const dayNum  = d.getDate()
  const mon     = d.toLocaleDateString('en-IN', { month: 'short' })

  return (
    <div className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-zinc-50 py-2 dark:bg-zinc-800">
        <span className="text-[10px] font-medium text-zinc-400 uppercase">{dayName}</span>
        <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-none">{dayNum}</span>
        <span className="text-[10px] font-medium text-zinc-400">{mon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}>{cfg.label}</span>
          {event.impact && event.impact !== 'info' && (
            <span className={`h-1.5 w-1.5 rounded-full ${IMPACT_DOT[event.impact] ?? 'bg-zinc-300'}`} />
          )}
          {event.symbol && (
            <span className="text-[10px] font-mono text-zinc-400">{event.symbol.replace(/\.(NS|BO)$/, '')}</span>
          )}
        </div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{event.title}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{event.description}</p>
      </div>
    </div>
  )
}

function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  return events.reduce((acc, e) => {
    if (!acc[e.date]) acc[e.date] = []
    acc[e.date].push(e)
    return acc
  }, {} as Record<string, CalendarEvent[]>)
}

export default function CalendarView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [authChecked, setAuthChecked] = useState(false)

  const today = new Date()
  const fromDate = today.toISOString().slice(0, 10)
  const toDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const load = useCallback(async (t: string) => {
    setLoading(true)
    try {
      const data = await getCalendarEvents(t, fromDate, toDate)
      setEvents(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [fromDate, toDate])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    load(t)
  }, [router, load])

  if (!authChecked) return null

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter)
  const grouped = groupByDate(filtered)
  const dates = Object.keys(grouped).sort()

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'fo_expiry', label: 'F&O Expiry' },
    { key: 'weekly_expiry', label: 'Weekly Expiry' },
    { key: 'central_bank', label: 'RBI' },
    { key: 'earnings', label: 'Earnings' },
    { key: 'market_holiday', label: 'Holidays' },
  ]

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Economic Calendar" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Economic Calendar</h1>
          <p className="text-xs text-zinc-400">NSE F&O expiries, RBI policy dates, earnings & holidays — next 60 days</p>
        </div>

        {/* Filter pills */}
        <div className="mb-5 flex flex-wrap gap-2">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : dates.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">No events found for the selected filter.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {dates.map(date => (
              <div key={date}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                  <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                  <span className="text-[10px] text-zinc-400">{grouped[date].length} event{grouped[date].length > 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-2">
                  {grouped[date].map(e => <EventCard key={e.id} event={e} />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <p className="w-full text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Impact</p>
          {[{ color: 'bg-red-500', label: 'High' }, { color: 'bg-amber-400', label: 'Medium' }, { color: 'bg-zinc-300', label: 'Info' }].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${l.color}`} />
              <span className="text-xs text-zinc-500">{l.label}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

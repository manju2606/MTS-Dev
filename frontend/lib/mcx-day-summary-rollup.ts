import type { McxDaySummary } from '@/lib/api'

// Pure aggregation helpers: turn a list of already-stored daily McxDaySummary
// entries into a "this week"/"this month" narrative -- same idea as
// mcx-view.tsx's NgDashboardHistory (which aggregates daily OHLCV snapshots
// into Day/Week/Month views client-side, no separate weekly/monthly storage
// job), applied to the crisp day-summary narrative instead of a raw table.

function istTodayStr(): string {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = ist.getFullYear()
  const m = String(ist.getMonth() + 1).padStart(2, '0')
  const d = String(ist.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Monday-anchored ISO week key ("YYYY-MM-DD" of that week's Monday) -- same
// week boundary the backend's get_range_stats/get_metal_range_stats use for
// week_high/week_low, so the last day in a week group already carries that
// week's complete range.
function isoWeekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dow)
  return date.toISOString().slice(0, 10)
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7) // "YYYY-MM"
}

function fmtDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
}

export type PeriodSummary = {
  key: string
  label: string
  narrative: string
  inProgress: boolean
}

function buildPeriodSummary(
  key: string,
  label: string,
  days: McxDaySummary[],
  rangeKind: 'week' | 'month',
  inProgress: boolean,
): PeriodSummary {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const startPrice = first.prev_close || first.open
  const endPrice = last.close
  const changePct = startPrice ? ((endPrice - startPrice) / startPrice) * 100 : 0
  const up = sorted.filter(d => d.change_pct > 0).length
  const down = sorted.filter(d => d.change_pct < 0).length
  const rangeHigh = rangeKind === 'week' ? last.week_high : last.month_high
  const rangeLow = rangeKind === 'week' ? last.week_low : last.month_low
  const hitExtreme = sorted.some(d => d.new_extremes.some(e => e.includes(rangeKind)))

  const pct = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
  const dayWord = sorted.length === 1 ? 'day' : 'days'
  const asOf = inProgress ? 'latest day' : fmtDateShort(last.date)
  const narrative = [
    `${last.tradingsymbol} moved ${startPrice.toFixed(2)} → ${endPrice.toFixed(2)} (${pct}) over ${sorted.length} ${dayWord} (${up} up / ${down} down),`,
    `ranging ${rangeLow.toFixed(2)}-${rangeHigh.toFixed(2)}${hitExtreme ? ` (set a new ${rangeKind} extreme)` : ''}.`,
    `AI lean as of ${asOf}: ${last.ai_score_pct.toFixed(0)}% ${last.ai_lean} (${last.ai_verdict}).`,
  ].join(' ')

  return { key, label, narrative, inProgress }
}

export function buildWeekSummaries(history: McxDaySummary[], maxWeeks = 4): PeriodSummary[] {
  const groups = new Map<string, McxDaySummary[]>()
  for (const d of history) {
    const k = isoWeekKey(d.date)
    const arr = groups.get(k) ?? []
    arr.push(d)
    groups.set(k, arr)
  }
  const todayWeekKey = isoWeekKey(istTodayStr())
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, maxWeeks)
    .map(([key, days]) => {
      const monday = new Date(`${key}T00:00:00Z`)
      const friday = new Date(monday)
      friday.setUTCDate(monday.getUTCDate() + 4)
      const label = `Week of ${fmtDateShort(key)}–${fmtDateShort(friday.toISOString().slice(0, 10))}`
      return buildPeriodSummary(key, label, days, 'week', key === todayWeekKey)
    })
}

export function buildMonthSummaries(history: McxDaySummary[], maxMonths = 3): PeriodSummary[] {
  const groups = new Map<string, McxDaySummary[]>()
  for (const d of history) {
    const k = monthKey(d.date)
    const arr = groups.get(k) ?? []
    arr.push(d)
    groups.set(k, arr)
  }
  const todayMonthKey = monthKey(istTodayStr())
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, maxMonths)
    .map(([key, days]) => {
      const [y, m] = key.split('-').map(Number)
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      return buildPeriodSummary(key, label, days, 'month', key === todayMonthKey)
    })
}

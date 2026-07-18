import type { WatchlistHistoryPick, WatchlistHistorySnapshot } from '@/lib/api'

// Client-side week/month rollup for a single tracked pick's daily snapshots
// -- same technique as mcx-day-summary-rollup.ts (group already-stored daily
// rows client-side, no separate backend rollup storage), but here "period
// view" means the last snapshot within each bucket (this pick's price/P&L
// as of the end of that week/month), not a multi-metric range summary.

export type PeriodPnlRow = {
  key: string
  label: string
  price: number
  pnl_pct: number
}

// Monday-anchored ISO week key ("YYYY-MM-DD" of that week's Monday).
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

function fmtMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function buildRows(
  snapshots: WatchlistHistorySnapshot[],
  keyFn: (dateStr: string) => string,
  labelFn: (key: string) => string,
): PeriodPnlRow[] {
  const buckets = new Map<string, WatchlistHistorySnapshot[]>()
  for (const s of snapshots) {
    const k = keyFn(s.date)
    const arr = buckets.get(k) ?? []
    arr.push(s)
    buckets.set(k, arr)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, snaps]) => {
      const last = [...snaps].sort((a, b) => a.date.localeCompare(b.date))[snaps.length - 1]
      return { key, label: labelFn(key), price: last.price, pnl_pct: last.pnl_pct }
    })
}

export function buildWeeklyPnlRows(pick: WatchlistHistoryPick): PeriodPnlRow[] {
  return buildRows(pick.snapshots, isoWeekKey, key => `Week of ${fmtDateShort(key)}`)
}

export function buildMonthlyPnlRows(pick: WatchlistHistoryPick): PeriodPnlRow[] {
  return buildRows(pick.snapshots, monthKey, fmtMonthLabel)
}

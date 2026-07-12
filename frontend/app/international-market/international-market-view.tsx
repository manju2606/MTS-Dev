'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import { getInternationalMarketDashboard, getInternationalMarketPrediction } from '@/lib/api'
import type {
  InternationalMarketDashboard, InternationalMarketPrediction, InternationalMarketPredictionPeriod,
  InternationalMarketRow, InternationalMarketSignal, InternationalMarketTrend,
} from '@/lib/api'
import { readPageCache, writePageCache } from '@/lib/page-cache'

const DASHBOARD_CACHE_KEY = 'international-market:dashboard'
const PREDICTION_CACHE_KEY_PREFIX = 'international-market:prediction:'
const SELECTED_CODE_CACHE_KEY = 'international-market:selected-code'

const POLL_MS = 30_000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// The 9 timeframes AI Prediction covers, in display order -- matches
// global_indices_prediction_service.PREDICTION_PERIODS' keys.
const PREDICTION_PERIODS: InternationalMarketPredictionPeriod[] = [
  '5m', '15m', '30m', '1h', '4h', '8h', '1D', '1W', '1M',
]
const PREDICTION_LABELS: Record<InternationalMarketPredictionPeriod, string> = {
  '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '8h': '8H',
  '1D': '1D', '1W': '1W', '1M': '1M',
}

// Broad region buckets the dashboard sections by -- matches
// global_indices_service.TRACKED_INDICES' `group` field. Display order,
// not alphabetical.
const REGION_ORDER = ['America', 'Europe', 'Asia', 'India', 'Middle East', 'Other'] as const
const REGION_ICON: Record<string, string> = {
  America: '🇺🇸', Europe: '🇪🇺', Asia: '🌏', India: '🇮🇳', 'Middle East': '🌍', Other: '🌎',
}

// Same rank-tiered palette as My Trading Dashboard/Crypto/USA Stocks
// (matching AI_Commodity_Trading_Dashboard_Pro_v3.html): best AI Score
// emerald, worst dark red. Rank is local to each region section, not
// global across all tracked indices.
const TILE_BG = ['#065f46', '#15803d', '#4d7c0f', '#b45309', '#991b1b']
function tileColor(rank: number): string {
  return TILE_BG[Math.min(rank, TILE_BG.length - 1)]
}

const TREND_COLOR: Record<InternationalMarketTrend, string> = {
  Bullish: '#22c55e',
  Bearish: '#ef4444',
  Neutral: '#94a3b8',
}
const TREND_ARROW: Record<InternationalMarketTrend, string> = {
  Bullish: '▲',
  Bearish: '▼',
  Neutral: '—',
}
// Same three-way palette as My Trading Dashboard's SIGNAL_COLOR.
const SIGNAL_COLOR: Record<InternationalMarketSignal, string> = {
  BUY: '#22c55e',
  HOLD: '#facc15',
  SELL: '#ef4444',
}

// Index levels aren't a single currency (FTSE is GBP-based, Nikkei
// JPY-based, DAX EUR-based, etc.) -- shown as plain index points, no
// currency symbol, unlike USA Stocks'/Crypto's $ prices.
function fmtLevel(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtVolume(v: number | null): string {
  if (v === null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toLocaleString('en-US')
}

function fmtChange(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function PctChange({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: '#64748b' }}>—</span>
  const pos = pct >= 0
  return (
    <span style={{ color: pos ? '#22c55e' : '#ef4444' }}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function HeatTile({
  row, rank, selected, onClick,
}: { row: InternationalMarketRow; rank: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-4 text-center font-bold shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform ${
        selected ? 'scale-[1.03] ring-2 ring-white/70' : 'hover:scale-[1.02]'
      }`}
      style={{ background: tileColor(rank), color: '#eef2ff' }}
    >
      <div className="text-lg">{RANK_MEDALS[rank] ?? `#${rank + 1}`}</div>
      <div className="mt-1 text-sm">{row.name}</div>
      <p className="text-[10px] font-normal opacity-80">{row.region}</p>
      <p className="mt-2 text-xl font-extrabold">{fmtLevel(row.price)}</p>
      <p className="mt-1 text-xs">
        <span style={{ color: TREND_COLOR[row.trend] }}>{TREND_ARROW[row.trend]} {row.trend}</span>
      </p>
      <p className="mt-1 text-xs opacity-90">AI Score {row.ai_score}</p>
    </button>
  )
}

function RankRow({
  row, rank, selected, onClick,
}: { row: InternationalMarketRow; rank: number; selected: boolean; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer"
      style={{ borderBottom: '1px solid #24324d', background: selected ? '#1e293b' : undefined }}
    >
      <td className="px-2 py-2 text-center">{RANK_MEDALS[rank] ?? rank + 1}</td>
      <td className="px-2 py-2 text-left">
        <span className="font-medium">{row.name}</span>
      </td>
      <td className="px-2 py-2 text-center">{row.region}</td>
      <td className="px-2 py-2 text-center">{fmtLevel(row.price)}</td>
      <td className="px-2 py-2 text-center">
        <span style={{ color: (row.change ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtChange(row.change)}</span>
      </td>
      <td className="px-2 py-2 text-center"><PctChange pct={row.change_pct} /></td>
      <td className="px-2 py-2 text-center font-bold" style={{ color: TREND_COLOR[row.trend] }}>
        {TREND_ARROW[row.trend]} {row.trend}
      </td>
      <td className="px-2 py-2 text-center font-bold" style={{ color: SIGNAL_COLOR[row.signal] }}>
        {row.signal}
      </td>
      <td className="px-2 py-2 text-center font-semibold">{row.ai_score}</td>
      <td className="px-2 py-2 text-center">{row.confidence_pct}%</td>
    </tr>
  )
}

function RegionSection({
  group, rows, selectedCode, onSelect,
}: { group: string; rows: InternationalMarketRow[]; selectedCode: string | null; onSelect: (code: string) => void }) {
  return (
    <div className="mb-10">
      <h3 className="mb-3 text-sm font-bold" style={{ color: '#cbd5e1' }}>
        {REGION_ICON[group] ?? '🌐'} {group} <span style={{ color: '#64748b' }}>({rows.length})</span>
      </h3>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((row, i) => (
          <HeatTile
            key={row.code} row={row} rank={i}
            selected={row.code === selectedCode} onClick={() => onSelect(row.code)}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ background: '#141d33' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: '#1e3a8a' }}>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Rank</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-semibold">Index</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Country</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">LTP</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Change</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">% Change</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Trend</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">AI Signal</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">AI Score</th>
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <RankRow
                key={row.code} row={row} rank={i}
                selected={row.code === selectedCode} onClick={() => onSelect(row.code)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: '#0f1830' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: '#64748b' }}>{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  )
}

function LiveMetricsPanel({ row }: { row: InternationalMarketRow }) {
  const marketOpen = row.market_status === 'Open'
  return (
    <div className="mb-8 rounded-xl p-4" style={{ background: '#141d33' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">
          📈 Live Metrics &mdash; {row.name} <span className="font-normal" style={{ color: '#64748b' }}>({row.region})</span>
        </h3>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ background: marketOpen ? '#065f46' : '#450a0a', color: marketOpen ? '#4ade80' : '#fca5a5' }}
        >
          {marketOpen ? '● Market Open' : '● Market Closed'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCell label="Current Price" value={fmtLevel(row.price)} />
        <MetricCell label="Open" value={fmtLevel(row.open)} />
        <MetricCell label="High" value={fmtLevel(row.day_high)} />
        <MetricCell label="Low" value={fmtLevel(row.day_low)} />
        <MetricCell label="Prev Close" value={fmtLevel(row.prev_close)} />
        <MetricCell label="Today's Range" value={`${fmtLevel(row.day_low)} – ${fmtLevel(row.day_high)}`} />
        <MetricCell label="52 Week High" value={fmtLevel(row.year_high)} />
        <MetricCell label="52 Week Low" value={fmtLevel(row.year_low)} />
        <MetricCell label="Volume" value={fmtVolume(row.volume)} />
        <MetricCell label="Market Cap" value={row.market_cap === null ? 'N/A (index)' : fmtVolume(row.market_cap)} />
        <MetricCell label="Futures Price" value="N/A" />
        <MetricCell
          label="Gap Up / Down"
          value={row.gap === null ? '—' : `${fmtChange(row.gap)} (${row.gap_pct?.toFixed(2)}%)`}
        />
      </div>
      <p className="mt-3 text-[10px]" style={{ color: '#475569' }}>
        Futures Price isn&apos;t available -- most of these indices have no liquid, freely-available futures ticker.
        Market Open/Closed is an approximation (a blanket local trading-hours window per exchange), not a real
        trading-calendar lookup, so it can be off around holidays.
      </p>
    </div>
  )
}

// Magnitude highlight (independent of sign): >3-5% yellow, >5-10% light
// blue, >10% light green -- same bands as My Trading Dashboard/Crypto/USA
// Stocks' predicted-price cells.
function magnitudeHighlight(pct: number): string | null {
  const abs = Math.abs(pct)
  if (abs > 10) return '#4ade80'
  if (abs > 5) return '#38bdf8'
  if (abs > 3) return '#facc15'
  return null
}

function PredictionCard({ period, point }: { period: InternationalMarketPredictionPeriod; point: InternationalMarketPrediction['predicted'][InternationalMarketPredictionPeriod] }) {
  if (!point) {
    return (
      <div className="rounded-lg px-3 py-2 text-center" style={{ background: '#0f1830' }}>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: '#64748b' }}>{PREDICTION_LABELS[period]}</p>
        <p className="mt-1 text-xs" style={{ color: '#64748b' }}>—</p>
      </div>
    )
  }
  const highlight = magnitudeHighlight(point.pct_change)
  return (
    <div
      className="rounded-lg px-3 py-2 text-center"
      style={{ background: highlight ?? '#0f1830', color: highlight ? '#0b1220' : undefined }}
    >
      <p
        className="text-[10px] uppercase tracking-wide"
        style={{ color: highlight ? '#0b1220' : '#64748b', opacity: highlight ? 0.7 : 1 }}
      >
        {PREDICTION_LABELS[period]}
      </p>
      <p className="mt-1 text-sm font-bold">{fmtLevel(point.predicted_close)}</p>
      <p
        className="text-xs font-semibold"
        style={{ color: highlight ? '#0b1220' : (point.pct_change >= 0 ? '#22c55e' : '#ef4444') }}
      >
        {point.pct_change >= 0 ? '+' : ''}{point.pct_change.toFixed(2)}%
      </p>
    </div>
  )
}

function AIPredictionPanel({
  name, region, prediction, loading, error,
}: { name: string; region: string; prediction: InternationalMarketPrediction | null; loading: boolean; error: string | null }) {
  return (
    <div className="mb-8 rounded-xl p-4" style={{ background: '#141d33' }}>
      <h3 className="mb-3 text-base font-bold">
        🤖 AI Prediction &mdash; {name} <span className="font-normal" style={{ color: '#64748b' }}>({region})</span>
      </h3>
      {error && (
        <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>{error}</div>
      )}
      {loading && !prediction ? (
        <div className="flex justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : prediction ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {PREDICTION_PERIODS.map(period => (
            <PredictionCard key={period} period={period} point={prediction.predicted[period]} />
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-[10px]" style={{ color: '#475569' }}>
        Same local heuristic as Trend/AI Score (EMA slope + ROC momentum + ATR cone), not a trained model. 4H/8H
        have no native candle source -- extrapolated from 1H candles instead of MCX-style real resampling (MCX
        itself doesn&apos;t truly resample for these periods either, just spaces predictions further apart).
      </p>
    </div>
  )
}

export default function InternationalMarketView() {
  const [data, setData] = useState<{ generated_at: string; period: string; method: string } | null>(null)
  const [ranked, setRanked] = useState<InternationalMarketRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<InternationalMarketPrediction | null>(null)
  const [predictionLoading, setPredictionLoading] = useState(false)
  const [predictionErr, setPredictionErr] = useState<string | null>(null)
  const tokenRef = useRef('')

  // Prefers whatever's already selected, then the last selection cached
  // from a previous visit (as long as it's still in this dashboard's
  // rows), then falls back to the top-ranked row.
  const defaultSelectedCode = useCallback((prev: string | null, rows: InternationalMarketRow[]) => {
    if (prev) return prev
    const cachedCode = readPageCache<string>(SELECTED_CODE_CACHE_KEY)
    if (cachedCode && rows.some(r => r.code === cachedCode)) return cachedCode
    return rows[0]?.code ?? null
  }, [])

  const selectCode = useCallback((code: string) => {
    setSelectedCode(code)
    writePageCache(SELECTED_CODE_CACHE_KEY, code)
  }, [])

  const load = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await getInternationalMarketDashboard(token)
      setData({ generated_at: res.generated_at, period: res.period, method: res.method })
      setRanked(res.ranked)
      setSelectedCode(prev => defaultSelectedCode(prev, res.ranked))
      writePageCache(DASHBOARD_CACHE_KEY, res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load International Market dashboard')
      setRanked(prev => prev ?? [])
    }
  }, [defaultSelectedCode])

  useEffect(() => {
    tokenRef.current = localStorage.getItem('mts_token') ?? ''
    // Show the last-known dashboard instantly (from a previous visit)
    // instead of a blank spinner, then load() below fetches fresh data
    // in the background and overwrites both state and the cache. The
    // setState calls are deferred a microtask so they're not synchronous
    // within the effect body (react-hooks/set-state-in-effect).
    const cached = readPageCache<InternationalMarketDashboard>(DASHBOARD_CACHE_KEY)
    if (cached) {
      Promise.resolve().then(() => {
        setData({ generated_at: cached.generated_at, period: cached.period, method: cached.method })
        setRanked(cached.ranked)
        setSelectedCode(prev => defaultSelectedCode(prev, cached.ranked))
      })
    }
    load().catch(() => {})
    const id = setInterval(() => { load().catch(() => {}) }, POLL_MS)
    return () => clearInterval(id)
  }, [load, defaultSelectedCode])

  useEffect(() => {
    const token = tokenRef.current
    if (!token || !selectedCode) return
    // Show the last-known prediction for this index instantly (from a
    // previous visit) instead of a blank spinner, then the fetch below
    // refreshes it in the background and overwrites both state and the
    // cache. Deferred a microtask so the cache-read setState isn't
    // synchronous within the effect body (react-hooks/set-state-in-effect).
    const cacheKey = `${PREDICTION_CACHE_KEY_PREFIX}${selectedCode}`
    const cached = readPageCache<InternationalMarketPrediction>(cacheKey)
    if (cached) Promise.resolve().then(() => setPrediction(cached))
    setPredictionLoading(true)
    setPredictionErr(null)
    getInternationalMarketPrediction(token, selectedCode)
      .then(res => { setPrediction(res); writePageCache(cacheKey, res) })
      .catch(e => setPredictionErr(e instanceof Error ? e.message : 'Failed to load AI Prediction'))
      .finally(() => setPredictionLoading(false))
  }, [selectedCode])

  const rows = useMemo(() => ranked ?? [], [ranked])
  const selectedRow = useMemo(() => rows.find(r => r.code === selectedCode) ?? null, [rows, selectedCode])

  // Grouped by region (America/Europe/Asia/India/Middle East/Other), each
  // group's rows ranked by AI Score descending within that group -- a
  // global ranking across all tracked indices doesn't answer "which is
  // the best performer *in Europe*", which is the point of splitting by
  // region at all.
  const grouped = useMemo(() => {
    const byGroup = new Map<string, InternationalMarketRow[]>()
    for (const row of rows) {
      const list = byGroup.get(row.group) ?? []
      list.push(row)
      byGroup.set(row.group, list)
    }
    for (const list of byGroup.values()) {
      list.sort((a, b) => b.ai_score - a.ai_score)
    }
    const orderedKeys = [
      ...REGION_ORDER.filter(g => byGroup.has(g)),
      ...[...byGroup.keys()].filter(g => !(REGION_ORDER as readonly string[]).includes(g)),
    ]
    return orderedKeys.map(group => ({ group, rows: byGroup.get(group) ?? [] }))
  }, [rows])

  return (
    <div className="min-h-screen" style={{ background: '#0b1220', color: '#eef2ff' }}>
      <NavBar active="Global Indices" />

      <div
        className="px-4 py-4 text-center text-xl font-bold sm:text-2xl"
        style={{ background: 'linear-gradient(90deg,#2563eb,#7c3aed,#06b6d4)' }}
      >
        🌐 International Market
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm" style={{ color: '#cbd5e1' }}>
            Major global market indices, grouped by region and ranked by AI Score within each. Trend/AI
            Score/Confidence/Signal are derived from the same local heuristic (EMA slope + ROC momentum + ATR
            conviction) used elsewhere in this app on the daily timeframe &mdash; not a trained model, and not the
            fuller technicals+news AI Score MCX&apos;s own dashboard computes. Index levels are shown in each
            index&apos;s own native units, not a single currency. Click any tile or row to see its Live Metrics.
          </p>
          <div className="flex flex-col items-end gap-2">
            {data && (
              <div className="text-right text-xs" style={{ color: '#64748b' }}>
                <p>Refreshes every {POLL_MS / 1000}s &middot; updated {timeAgo(data.generated_at)}</p>
                <p>Period: {data.period}</p>
              </div>
            )}
            <a
              href="/calendar"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-80"
              style={{ background: '#1e3a8a', color: '#bfdbfe' }}
            >
              📅 Economic Calendar &rarr;
            </a>
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded-xl px-4 py-3 text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>
            {err}
          </div>
        )}

        {ranked === null && !err ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl px-4 py-10 text-center text-sm" style={{ background: '#141d33', color: '#94a3b8' }}>
            No scored indices yet &mdash; check back shortly.
          </div>
        ) : (
          <>
            {selectedRow && <LiveMetricsPanel row={selectedRow} />}
            {selectedRow && (
              <AIPredictionPanel
                name={selectedRow.name} region={selectedRow.region}
                prediction={prediction} loading={predictionLoading} error={predictionErr}
              />
            )}

            {grouped.map(({ group, rows: groupRows }) => (
              <RegionSection
                key={group} group={group} rows={groupRows}
                selectedCode={selectedCode} onSelect={selectCode}
              />
            ))}

            <p className="mt-2 text-xs" style={{ color: '#64748b' }}>
              AI Score/Trend/Confidence/Signal are a simple heuristic derivation, refreshed on each dashboard load
              from the already-cached daily candles &mdash; not a persisted/tracked score like MCX&apos;s AI
              Strength.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

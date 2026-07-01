'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getTopPicks } from '@/lib/api'
import type { StockScore } from '@/lib/api'

// ── Squarified treemap ────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number }

function worstRatio(areas: number[], short: number): number {
  if (!areas.length || short <= 0) return Infinity
  const S = areas.reduce((a, b) => a + b, 0)
  if (S <= 0) return Infinity
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const s2 = short * short
  const S2 = S * S
  return Math.max(s2 * max / S2, S2 / (s2 * min))
}

function squarify(values: number[], bx: number, by: number, bw: number, bh: number): Rect[] {
  const n = values.length
  if (!n) return []
  if (bw <= 0 || bh <= 0) return values.map(() => ({ x: bx, y: by, w: 0, h: 0 }))

  const total = values.reduce((s, v) => s + v, 0)
  const areas = total > 0 ? values.map(v => (v / total) * bw * bh) : values.map(() => bw * bh / n)
  const rects: Rect[] = new Array(n)

  function sub(idxs: number[], x: number, y: number, w: number, h: number) {
    if (!idxs.length) return
    if (idxs.length === 1) { rects[idxs[0]] = { x, y, w, h }; return }

    const short = Math.min(w, h)
    const rowAreas: number[] = []

    for (let k = 0; k < idxs.length; k++) {
      const prev = rowAreas.length ? worstRatio(rowAreas, short) : Infinity
      rowAreas.push(areas[idxs[k]])
      const curr = worstRatio(rowAreas, short)
      if (k > 0 && curr > prev) { rowAreas.pop(); break }
    }

    const rowIdxs  = idxs.slice(0, rowAreas.length)
    const rest     = idxs.slice(rowAreas.length)
    const rowSum   = rowAreas.reduce((s, v) => s + v, 0)
    const totalSum = idxs.reduce((s, i) => s + areas[i], 0)

    if (w >= h) {
      const sw = (rowSum / totalSum) * w
      let py = y
      rowIdxs.forEach((idx, j) => {
        const ih = (rowAreas[j] / rowSum) * h
        rects[idx] = { x, y: py, w: sw, h: ih }
        py += ih
      })
      sub(rest, x + sw, y, w - sw, h)
    } else {
      const sh = (rowSum / totalSum) * h
      let px = x
      rowIdxs.forEach((idx, j) => {
        const iw = (rowAreas[j] / rowSum) * w
        rects[idx] = { x: px, y, w: iw, h: sh }
        px += iw
      })
      sub(rest, x, y + sh, w, h - sh)
    }
  }

  sub(values.map((_, i) => i), bx, by, bw, bh)
  return rects
}

// ── Constants & helpers ───────────────────────────────────────────────────────

const SIG_COLOR: Record<string, string> = {
  STRONG_BUY:  '#00622a',
  BUY:         '#007a33',
  WATCH:       '#7a5200',
  NEUTRAL:     '#2a2a2e',
  SELL:        '#a62020',
  STRONG_SELL: '#7a1515',
}

const SIG_HOVER: Record<string, string> = {
  STRONG_BUY:  '#008535',
  BUY:         '#009c40',
  WATCH:       '#9a6800',
  NEUTRAL:     '#3c3c42',
  SELL:        '#c82828',
  STRONG_SELL: '#9a1a1a',
}

const SIG_LABEL: Record<string, string> = {
  STRONG_BUY: 'Strong Buy', BUY: 'Buy', WATCH: 'Watch',
  NEUTRAL: 'Neutral', SELL: 'Sell', STRONG_SELL: 'Strong Sell',
}

const HEADER_H = 22
const GAP = 2

// ── Data shaping ──────────────────────────────────────────────────────────────

type SectorGroup = { name: string; stocks: StockScore[]; total: number }

function filterPicks(picks: StockScore[], sig: string): StockScore[] {
  if (sig === 'All') return picks
  if (sig === 'BUY+') return picks.filter(p => ['STRONG_BUY', 'BUY'].includes(p.signal))
  if (sig === 'SELL+') return picks.filter(p => ['STRONG_SELL', 'SELL'].includes(p.signal))
  return picks.filter(p => p.signal === sig)
}

function groupBySector(picks: StockScore[]): SectorGroup[] {
  const map: Record<string, StockScore[]> = {}
  for (const p of picks) {
    const s = p.sector || 'Other'
    ;(map[s] ??= []).push(p)
  }
  return Object.entries(map)
    .map(([name, stocks]) => ({
      name,
      stocks: [...stocks].sort((a, b) => b.score - a.score),
      total: stocks.reduce((s, p) => s + Math.max(p.score, 1), 0),
    }))
    .sort((a, b) => b.total - a.total)
}

// ── Layout builders ───────────────────────────────────────────────────────────

type LayoutSector = {
  name: string
  sRect: Rect
  tiles: { stock: StockScore; rect: Rect }[]
}

function buildSectorLayout(groups: SectorGroup[], w: number, h: number): LayoutSector[] {
  if (!groups.length || w <= 0 || h <= 0) return []
  const sRects = squarify(groups.map(g => g.total), 0, 0, w, h)
  return groups.map((g, gi) => {
    const sr = sRects[gi]
    const ix = sr.x + GAP
    const iy = sr.y + HEADER_H
    const iw = sr.w - GAP * 2
    const ih = sr.h - HEADER_H - GAP
    if (iw < 6 || ih < 6 || !g.stocks.length) return { name: g.name, sRect: sr, tiles: [] }
    const stockRects = squarify(g.stocks.map(s => Math.max(s.score, 1)), ix, iy, iw, ih)
    return {
      name: g.name, sRect: sr,
      tiles: g.stocks.map((stock, si) => ({
        stock,
        rect: {
          x: stockRects[si].x + 1, y: stockRects[si].y + 1,
          w: Math.max(0, stockRects[si].w - 2), h: Math.max(0, stockRects[si].h - 2),
        },
      })),
    }
  })
}

type FlatTile = { stock: StockScore; rect: Rect }

function buildFlatLayout(picks: StockScore[], w: number, h: number): FlatTile[] {
  if (!picks.length || w <= 0 || h <= 0) return []
  const sorted = [...picks].sort((a, b) => b.score - a.score)
  const rects = squarify(sorted.map(s => Math.max(s.score, 1)), 0, 0, w, h)
  return sorted.map((stock, i) => ({
    stock,
    rect: {
      x: rects[i].x + 1, y: rects[i].y + 1,
      w: Math.max(0, rects[i].w - 2), h: Math.max(0, rects[i].h - 2),
    },
  }))
}

// ── Tile ──────────────────────────────────────────────────────────────────────

function Tile({
  stock, rect, onEnter, onMove, onLeave,
}: {
  stock: StockScore
  rect: Rect
  onEnter: (e: React.MouseEvent, s: StockScore) => void
  onMove:  (e: React.MouseEvent) => void
  onLeave: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const sym = stock.symbol.replace(/\.(NS|BO)$/, '')
  const fs = Math.min(14, Math.max(8, rect.w / 5.5))

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        backgroundColor: hovered ? (SIG_HOVER[stock.signal] ?? '#3c3c42') : (SIG_COLOR[stock.signal] ?? '#2a2a2e'),
        overflow: 'hidden',
        cursor: 'pointer',
        border: '1px solid rgba(0,0,0,0.5)',
        borderRadius: 2,
        transition: 'background-color 0.1s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { setHovered(true); onEnter(e, stock) }}
      onMouseMove={onMove}
      onMouseLeave={() => { setHovered(false); onLeave() }}
    >
      {rect.w > 26 && rect.h > 16 && (
        <div style={{ padding: '3px 5px' }}>
          <p style={{
            color: 'rgba(255,255,255,0.95)', fontWeight: 700,
            fontSize: fs, lineHeight: 1.15,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sym}</p>
          {rect.h > 36 && (
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: Math.max(7, fs - 3), marginTop: 1 }}>
              {stock.score.toFixed(0)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ stock, mx, my }: { stock: StockScore; mx: number; my: number }) {
  const t1 = stock.targets[0], t2 = stock.targets[1]
  return (
    <div
      style={{
        position: 'fixed', left: mx + 14, top: my - 8,
        zIndex: 9999, pointerEvents: 'none',
        transform: mx > window.innerWidth - 230 ? 'translateX(-115%)' : undefined,
      }}
      className="min-w-[210px] rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-white">{stock.symbol.replace(/\.(NS|BO)$/, '')}</p>
          <p className="text-[11px] text-zinc-400 leading-tight">{stock.name}</p>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: SIG_COLOR[stock.signal] }}
        >
          {SIG_LABEL[stock.signal]}
        </span>
      </div>
      <div className="space-y-1 text-[11px]">
        {[
          ['Score',    stock.score.toFixed(1), ''],
          ['Sector',   stock.sector, ''],
          ['Entry',    `₹${stock.entry_price.toFixed(2)}`, 'text-zinc-200'],
          ['Stop',     `₹${stock.stop_loss.toFixed(2)}`, 'text-red-400'],
          ['Target 1', t1 ? `₹${t1.toFixed(2)}` : '—', 'text-emerald-400'],
          ['Target 2', t2 ? `₹${t2.toFixed(2)}` : '—', 'text-emerald-400'],
          ['R:R',      stock.risk_reward_ratio.toFixed(2), ''],
          ['Hold',     stock.holding_period, ''],
        ].map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-zinc-500">{k}</span>
            <span className={`font-medium text-zinc-200 ${cls}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

const SIG_FILTERS = ['All', 'BUY+', 'WATCH', 'SELL+']

export function HeatmapView() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)

  const [picks, setPicks]       = useState<StockScore[] | null>(null)
  const [dims, setDims]         = useState({ w: 0, h: 0 })
  const [view, setView]         = useState<'sector' | 'flat'>('sector')
  const [sigFilter, setSigFilter] = useState('All')
  const [tooltip, setTooltip]   = useState<{ stock: StockScore; mx: number; my: number } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('mts_token')
    if (!token) { router.replace('/login'); return }
    getTopPicks(token, 50, undefined, 0)
      .then(setPicks)
      .catch(() => router.replace('/login'))
  }, [router])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setDims({ w: Math.floor(width), h: Math.floor(height) })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const filtered = useMemo(() => picks ? filterPicks(picks, sigFilter) : [], [picks, sigFilter])
  const groups   = useMemo(() => groupBySector(filtered), [filtered])

  const sectorLayout = useMemo(
    () => view === 'sector' ? buildSectorLayout(groups, dims.w, dims.h) : [],
    [view, groups, dims]
  )
  const flatLayout = useMemo(
    () => view === 'flat' ? buildFlatLayout(filtered, dims.w, dims.h) : [],
    [view, filtered, dims]
  )

  const handleEnter = useCallback((e: React.MouseEvent, stock: StockScore) => {
    setTooltip({ stock, mx: e.clientX, my: e.clientY })
  }, [])
  const handleMove = useCallback((e: React.MouseEvent) => {
    setTooltip(t => t ? { ...t, mx: e.clientX, my: e.clientY } : null)
  }, [])
  const handleLeave = useCallback(() => setTooltip(null), [])

  const bullish = picks?.filter(p => ['STRONG_BUY', 'BUY'].includes(p.signal)).length ?? 0
  const bearish = picks?.filter(p => ['STRONG_SELL', 'SELL'].includes(p.signal)).length ?? 0

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <NavBar active="Markets" />

      {/* Controls */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-zinc-100">Market Heat Map</h1>
            {picks && (
              <span className="text-xs text-zinc-500">
                {filtered.length} stocks
                {sigFilter === 'All' && (
                  <> ·
                    <span className="text-emerald-500"> {bullish} bullish</span>
                    {' / '}
                    <span className="text-red-500">{bearish} bearish</span>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle */}
            <div className="flex overflow-hidden rounded-md border border-zinc-700">
              {(['sector', 'flat'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${
                    view === v ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  }`}>
                  {v === 'sector' ? 'By Sector' : 'Flat'}
                </button>
              ))}
            </div>

            {/* Signal filter */}
            <div className="flex overflow-hidden rounded-md border border-zinc-700">
              {SIG_FILTERS.map(f => (
                <button key={f} onClick={() => setSigFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium ${
                    sigFilter === f ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1"
        style={{ minHeight: 500 }}
        onMouseLeave={handleLeave}
      >
        {/* Loading */}
        {!picks && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <p className="text-sm text-zinc-400">Loading heat map…</p>
            </div>
          </div>
        )}

        {/* Empty */}
        {picks && filtered.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="mb-1 text-lg font-semibold text-zinc-300">No picks to display</p>
              <p className="text-sm text-zinc-500">
                {sigFilter !== 'All' ? 'Try "All" filter, or ' : ''}
                run a scan from the Discovery page.
              </p>
            </div>
          </div>
        )}

        {/* ── Sector view ── */}
        {view === 'sector' && sectorLayout.map(sector => (
          <div key={sector.name}>
            {/* Sector header */}
            {sector.sRect.w > 30 && sector.sRect.h > HEADER_H && (
              <div
                style={{
                  position: 'absolute',
                  left: sector.sRect.x, top: sector.sRect.y,
                  width: sector.sRect.w, height: HEADER_H,
                  backgroundColor: '#161b22',
                  borderTop: '1px solid #30363d',
                  borderLeft: '1px solid #30363d',
                  display: 'flex', alignItems: 'center',
                  padding: '0 8px',
                  overflow: 'hidden',
                }}
              >
                <span style={{
                  color: '#8b949e', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                }}>
                  {sector.name}
                </span>
                <span style={{ color: '#484f58', fontSize: 9, marginLeft: 6 }}>
                  {sector.tiles.length}
                </span>
              </div>
            )}

            {/* Stock tiles */}
            {sector.tiles.map(({ stock, rect }) =>
              rect.w >= 4 && rect.h >= 4 ? (
                <Tile key={stock.symbol} stock={stock} rect={rect}
                  onEnter={handleEnter} onMove={handleMove} onLeave={handleLeave} />
              ) : null
            )}
          </div>
        ))}

        {/* ── Flat view ── */}
        {view === 'flat' && flatLayout.map(({ stock, rect }) =>
          rect.w >= 4 && rect.h >= 4 ? (
            <Tile key={stock.symbol} stock={stock} rect={rect}
              onEnter={handleEnter} onMove={handleMove} onLeave={handleLeave} />
          ) : null
        )}
      </div>

      {/* Legend */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-4 py-2">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-1">
          {Object.entries(SIG_LABEL).map(([sig, label]) => (
            <div key={sig} className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: SIG_COLOR[sig] }} />
              <span className="text-[10px] text-zinc-400">{label}</span>
            </div>
          ))}
          <span className="ml-auto text-[10px] text-zinc-600">
            Tile size = AI score · Hover for details
          </span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && <Tooltip stock={tooltip.stock} mx={tooltip.mx} my={tooltip.my} />}
    </div>
  )
}

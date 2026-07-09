'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getAssistantAnalysis, addHolding, deleteHolding, importHoldings, askAssistant,
  getAssistantFundamentals, getAssistantTimeline, getAssistantTax, getAssistantDividends, getAssistantCorrelation,
  getAssistantSentiment, getAssistantAISignals, getAssistantSummary, getAssistantOhlc,
  getBrokerStatus, getBrokerPositions,
  listPortfolios, createPortfolio, deletePortfolio, listWatchlists,
  searchStocks,
} from '@/lib/api'
import type {
  AssistantAnalysis, Holding, AssistantAlert, SizingRow,
  FundamentalRow, TimelineData, TaxData, DividendRow, CorrelationData, Portfolio,
  SentimentRow, AISignalRow, BrokerPosition, BrokerStatus, Watchlist,
  StockSearchResult, AssistantPeriodSummary, SummaryPeriod, OhlcRow,
} from '@/lib/api'
import { AddToWatchlistBtn } from '@/components/add-to-watchlist-btn'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }
function pnlColor(v: number) { return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-500' }
function fmt(n: number) { return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtCr(n: number) {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  return `₹${fmt(n)}`
}

const REC_STYLE: Record<string, string> = {
  SELL:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  REVIEW: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  HOLD:   'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  ADD:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  BUY:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

const SIGNAL_STYLE: Record<string, string> = {
  STRONG_BUY:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  BUY:         'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  WATCH:       'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  NEUTRAL:     'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  SELL:        'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  STRONG_SELL: 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-300',
}

const SECTOR_COLORS = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6',
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreGauge({ score, label, size = 96 }: { score: number; label: string; size?: number }) {
  const r = size / 2 - 8
  const circ = 2 * Math.PI * r
  const fill = circ * (1 - score / 100)
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" className="dark:stroke-zinc-700" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={fill}
          strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
          fontSize={size/5} fontWeight="700" fill={color}>{score.toFixed(0)}</text>
      </svg>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  )
}

function MiniDonut({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <div className="h-32 flex items-center justify-center text-xs text-zinc-400">No data</div>
  const size = 120; const r = 44; const cx = 60; const cy = 60
  let angle = -90
  const slices = data.map((d, i) => {
    const pct = d.value / total
    const sweep = pct * 360
    const start = angle
    angle += sweep
    const toRad = (a: number) => a * Math.PI / 180
    const x1 = cx + r * Math.cos(toRad(start))
    const y1 = cy + r * Math.sin(toRad(start))
    const x2 = cx + r * Math.cos(toRad(start + sweep))
    const y2 = cy + r * Math.sin(toRad(start + sweep))
    const large = sweep > 180 ? 1 : 0
    return { path: `M${cx},${cy} L${x1},${y1} A${r},${r},0,${large},1,${x2},${y2} Z`, color: SECTOR_COLORS[i % SECTOR_COLORS.length], label: d.label, pct: Math.round(pct * 100) }
  })
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
        <circle cx={cx} cy={cy} r={28} fill="white" className="dark:fill-zinc-900" />
      </svg>
      <div className="flex flex-col gap-1 text-xs">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-zinc-600 dark:text-zinc-300 truncate max-w-[100px]">{s.label}</span>
            <span className="text-zinc-400">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Portfolio Switcher ────────────────────────────────────────────────────────

function PortfolioSwitcher({
  portfolios, active, onSwitch, onNew, onDelete,
}: {
  portfolios: Portfolio[]
  active: string
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const showDelete = portfolios.length > 1

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {portfolios.map(p => (
        <div key={p.portfolio_id} className="relative flex items-center">
          <button
            onClick={() => onSwitch(p.portfolio_id)}
            className={cls(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              active === p.portfolio_id
                ? 'border-indigo-500 bg-indigo-600 text-white dark:border-indigo-500'
                : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500',
            )}
          >
            {p.name}
            <span className={cls(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              active === p.portfolio_id ? 'bg-indigo-500 text-indigo-100' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
            )}>
              {p.holdings_count}
            </span>
          </button>
          {showDelete && active === p.portfolio_id && (
            confirmDelete === p.portfolio_id ? (
              <div className="ml-1 flex items-center gap-1">
                <span className="text-xs text-red-500">Delete?</span>
                <button onClick={() => { onDelete(p.portfolio_id); setConfirmDelete(null) }}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500 text-white hover:bg-red-600">Yes</button>
                <button onClick={() => setConfirmDelete(null)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(p.portfolio_id)}
                className="ml-1 text-zinc-400 hover:text-red-400 text-xs leading-none" title="Delete portfolio">✕</button>
            )
          )}
        </div>
      ))}

      <button
        onClick={onNew}
        className="flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
      >
        + New Portfolio
      </button>
    </div>
  )
}

// ── New Portfolio Modal ────────────────────────────────────────────────────────

function NewPortfolioModal({ token, onCreated, onCancel }: {
  token: string
  onCreated: (p: Portfolio) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setErr(null)
    try {
      const p = await createPortfolio(token, name.trim())
      onCreated(p)
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Failed to create')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Portfolio</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Holding-2, Long Term, Dividend"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!name.trim() || saving}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={onCancel}
              className="flex-1 rounded-lg border border-zinc-300 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Add Holding Form ───────────────────────────────────────────────────────────

function SymbolAutocomplete({ token, value, onChange, onPick }: {
  token: string
  value: string
  onChange: (v: string) => void
  onPick: (r: StockSearchResult) => void
}) {
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([])
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  function handleChange(val: string) {
    onChange(val)
    if (searchRef.current) clearTimeout(searchRef.current)
    if (val.trim().length < 1) { setSuggestions([]); return }
    searchRef.current = setTimeout(() => {
      searchStocks(token, val).then(setSuggestions).catch(() => setSuggestions([]))
    }, 250)
  }

  function handlePick(r: StockSearchResult) {
    onChange(r.symbol.replace('.NS', '').replace('.BO', ''))
    setSuggestions([])
    onPick(r)
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSuggestions([])
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={boxRef} className="relative sm:col-span-1">
      <input value={value} onChange={e => handleChange(e.target.value)} placeholder="Symbol (e.g. SBIN)" required
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[80vw] rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {suggestions.map(r => (
            <li key={r.symbol}>
              <button type="button" onClick={() => handlePick(r)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {r.symbol.replace('.NS', '').replace('.BO', '')}
                </span>
                <span className="ml-2 truncate text-zinc-400">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddHoldingForm({ token, portfolioId, onAdded }: { token: string; portfolioId: string; onAdded: () => void }) {
  const [sym, setSym] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setSaving(true)
    try {
      await addHolding(token, { symbol: sym.trim(), qty: Number(qty), avg_price: Number(price), buy_date: date || undefined, portfolio_id: portfolioId })
      setSym(''); setQty(''); setPrice(''); setDate('')
      onAdded()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <SymbolAutocomplete token={token} value={sym} onChange={setSym} onPick={r => setSym(r.symbol.replace('.NS', '').replace('.BO', ''))} />
      <input value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" type="number" min="1" required
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Avg Price ₹" type="number" min="0.01" step="0.01" required
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
      <input value={date} onChange={e => setDate(e.target.value)} type="date"
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
      <button type="submit" disabled={saving}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
        {saving ? 'Adding…' : '+ Add'}
      </button>
      {err && <p className="col-span-full text-xs text-red-500">{err}</p>}
    </form>
  )
}

// ── CSV Import ────────────────────────────────────────────────────────────────

function CsvImport({ token, portfolioId, onImported }: { token: string; portfolioId: string; onImported: () => void }) {
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').filter(Boolean)
      const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
      const colIdx = (names: string[]) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1
      const symIdx   = colIdx(['symbol', 'ticker', 'scrip', 'stock'])
      const qtyIdx   = colIdx(['qty', 'quantity', 'shares'])
      const priceIdx = colIdx(['avg_price', 'avg price', 'buy_price', 'purchase_price', 'price', 'cost'])
      const dateIdx  = colIdx(['buy_date', 'date', 'purchase_date'])
      const nameIdx  = colIdx(['name', 'company'])
      if (symIdx < 0 || qtyIdx < 0 || priceIdx < 0) {
        setMsg('CSV must have columns: symbol, qty, avg_price')
        return
      }
      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/"/g, ''))
        return {
          symbol:    cols[symIdx] ?? '',
          qty:       Number(cols[qtyIdx] ?? 0),
          avg_price: Number(cols[priceIdx] ?? 0),
          buy_date:  dateIdx >= 0 ? cols[dateIdx] : undefined,
          name:      nameIdx >= 0 ? cols[nameIdx] : undefined,
        }
      }).filter(r => r.symbol && r.qty > 0 && r.avg_price > 0)

      setImporting(true)
      try {
        const { imported } = await importHoldings(token, rows, portfolioId)
        setMsg(`Imported ${imported} holdings.`)
        onImported()
      } catch { setMsg('Import failed.') }
      finally { setImporting(false) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-3">
      <label className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
        {importing ? 'Importing…' : 'Import CSV / Excel'}
        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
      </label>
      <a href="data:text/csv;charset=utf-8,symbol%2Cqty%2Cavg_price%2Cbuy_date%2Cname%0ASBIN%2C100%2C750.50%2C2024-01-15%2CState%20Bank%20of%20India%0ARELIANCE%2C50%2C2400.00%2C2024-02-10%2CReliance%20Industries"
        download="portfolio_template.csv"
        className="text-xs text-indigo-500 hover:underline dark:text-indigo-400">
        Download template
      </a>
      {msg && <span className="text-xs text-zinc-400">{msg}</span>}
    </div>
  )
}

// ── Tab sections ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: AssistantAnalysis }) {
  const { summary, alerts } = data
  const metrics = [
    { label: 'Total Invested',  value: fmtCr(summary.total_invested), accent: '' },
    { label: 'Current Value',   value: fmtCr(summary.current_value),  accent: '' },
    { label: 'Total P&L',       value: `${summary.total_pnl >= 0 ? '+' : ''}${fmtCr(summary.total_pnl)}`, accent: pnlColor(summary.total_pnl) },
    { label: 'Returns',         value: `${summary.total_pnl_pct >= 0 ? '+' : ''}${summary.total_pnl_pct.toFixed(2)}%`, accent: pnlColor(summary.total_pnl_pct) },
    { label: 'Win Rate',        value: `${summary.win_rate}%`, accent: summary.win_rate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400' },
    { label: 'Holdings',        value: String(summary.holdings_count), accent: '' },
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-400">{m.label}</p>
            <p className={`mt-1 text-lg font-bold ${m.accent || 'text-zinc-900 dark:text-zinc-50'}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex items-center justify-around rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <ScoreGauge score={summary.health_score} label="Health Score" />
          <ScoreGauge score={summary.diversification_score} label="Diversification" />
          <ScoreGauge score={summary.win_rate} label="Win Rate" />
        </div>
        <div className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Portfolio Alerts</p>
          {alerts.length === 0 ? (
            <p className="text-sm text-zinc-400">No alerts. Portfolio looks healthy.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a: AssistantAlert, i: number) => (
                <div key={i} className={cls(
                  'flex items-start gap-3 rounded-lg px-3 py-2 text-sm',
                  a.severity === 'high' ? 'bg-red-50 dark:bg-red-950/30' : 'bg-amber-50 dark:bg-amber-950/20'
                )}>
                  <span className={a.severity === 'high' ? 'text-red-500' : 'text-amber-500'}>
                    {a.type === 'LOSS' ? '▼' : '▲'}
                  </span>
                  <span className={a.severity === 'high' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}>{a.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Portfolio Scorecard</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Overall Health',     score: summary.health_score },
            { label: 'Diversification',    score: summary.diversification_score },
            { label: 'Win Rate',           score: summary.win_rate },
            { label: 'Return Quality',     score: Math.min(100, Math.max(0, 50 + summary.total_pnl_pct * 2)) },
          ].map(({ label, score }) => (
            <div key={label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">{label}</span>
                <span className={score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : score >= 50 ? 'text-amber-500' : 'text-red-500'}>{score.toFixed(0)}/100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={cls('h-full rounded-full transition-all', score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${score}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function HoldingsTab({ data, token, watchlists, onRefresh }: { data: AssistantAnalysis; token: string; watchlists: Watchlist[]; onRefresh: () => void }) {
  const [deleting, setDeleting] = useState<string | null>(null)

  async function remove(id: string) {
    setDeleting(id)
    await deleteHolding(token, id).catch(() => null)
    onRefresh()
    setDeleting(null)
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Symbol', 'Qty', 'Avg Price', 'CMP', 'Invested', 'Curr Value', 'P&L', 'AI Signal', 'Recommendation', '', ''].map(h => (
              <th key={h} className="px-3 py-3 text-left text-xs font-medium text-zinc-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
          {data.holdings.slice().reverse().map((h: Holding) => (
            <tr key={h.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td className="px-3 py-3">
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</p>
                <p className="text-[10px] text-zinc-400">{h.sector}</p>
              </td>
              <td className="px-3 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">{h.qty}</td>
              <td className="px-3 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">₹{fmt(h.avg_price)}</td>
              <td className="px-3 py-3 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">₹{fmt(h.current_price)}</td>
              <td className="px-3 py-3 font-mono text-xs text-zinc-500">₹{fmt(h.invested)}</td>
              <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-200">₹{fmt(h.current_value)}</td>
              <td className="px-3 py-3">
                <span className={`font-mono text-xs font-semibold ${pnlColor(h.pnl)}`}>
                  {h.pnl >= 0 ? '+' : ''}₹{fmt(h.pnl)}
                  <span className="block text-[10px] font-normal">{h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%</span>
                </span>
              </td>
              <td className="px-3 py-3">
                {h.ai_signal ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLE[h.ai_signal] ?? SIGNAL_STYLE.NEUTRAL}`}>
                    {h.ai_signal.replace('_', ' ')}
                  </span>
                ) : <span className="text-xs text-zinc-400">—</span>}
              </td>
              <td className="px-3 py-3">
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${REC_STYLE[h.recommendation] ?? REC_STYLE.HOLD}`}>
                    {h.recommendation}
                  </span>
                  <p className="mt-0.5 text-[10px] text-zinc-400 max-w-[140px]">{h.rec_reason}</p>
                </div>
              </td>
              <td className="px-3 py-3">
                <AddToWatchlistBtn symbol={h.symbol} token={token} watchlists={watchlists} />
              </td>
              <td className="px-3 py-3">
                <button onClick={() => remove(h.id)} disabled={deleting === h.id}
                  className="text-zinc-400 hover:text-red-500 dark:hover:text-red-400 text-xs disabled:opacity-40">
                  {deleting === h.id ? '…' : '✕'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AllocationTab({ data, portfolioId }: { data: AssistantAnalysis; portfolioId: string }) {
  const { sector_allocation, summary, sizing } = data
  const slices = Object.entries(sector_allocation).map(([label, value]) => ({ label, value }))
  const total = summary.current_value

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-400">Asset Allocation by Sector</p>
          <MiniDonut data={slices} />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-400">Sector Diversification</p>
          <div className="space-y-2">
            {slices.map(({ label, value }, i) => {
              const pct = total > 0 ? (value / total) * 100 : 0
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
                    <span className="text-zinc-400">{pct.toFixed(1)}% · {fmtCr(value)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Position Sizing Analysis</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Symbol', 'Weight', 'Invested', 'Status', 'Ideal Range'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {(sizing ?? []).map((r: SizingRow) => (
                <tr key={r.symbol}>
                  <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className={cls('h-full rounded-full', r.flag === 'OVERWEIGHT' ? 'bg-red-400' : r.flag === 'UNDERWEIGHT' ? 'bg-amber-400' : 'bg-indigo-400')}
                          style={{ width: `${Math.min(100, r.weight_pct * 5)}%` }} />
                      </div>
                      <span className="font-mono text-zinc-600 dark:text-zinc-300">{r.weight_pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-500">{fmtCr(r.invested)}</td>
                  <td className="px-3 py-2">
                    <span className={cls('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      r.flag === 'OVERWEIGHT' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                      r.flag === 'UNDERWEIGHT' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')}>
                      {r.flag}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">2% – 20%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CorrelationSection portfolioId={portfolioId} />
    </div>
  )
}

// ── Correlation Matrix ────────────────────────────────────────────────────────

function CorrelationSection({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<CorrelationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantCorrelation(t, portfolioId).then(d => { setData(d); setFetched(true); setLoading(false) }).catch(() => setLoading(false))
  }

  function corrColor(v: number) {
    if (v >= 0.7)  return 'bg-red-200 dark:bg-red-800/60'
    if (v >= 0.4)  return 'bg-amber-100 dark:bg-amber-900/40'
    if (v <= -0.4) return 'bg-emerald-100 dark:bg-emerald-900/40'
    return 'bg-zinc-50 dark:bg-zinc-800'
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Correlation Matrix</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Based on 6-month daily returns. Red = highly correlated (less diversification).</p>
        </div>
        {!fetched && <button onClick={load} disabled={loading} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{loading ? 'Computing…' : 'Load Correlation'}</button>}
      </div>
      {!fetched && !loading && <p className="text-xs text-zinc-400">Compute daily returns correlation for your holdings over 6 months.</p>}
      {loading && <div className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
      {fetched && data && data.symbols.length >= 2 && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="w-20 px-2 py-1" />
                {data.symbols.map(s => <th key={s} className="px-2 py-1 font-medium text-zinc-500">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.symbols.map((row, ri) => (
                <tr key={row}>
                  <td className="px-2 py-1 font-semibold text-zinc-700 dark:text-zinc-300">{row}</td>
                  {data.matrix[ri].map((v, ci) => (
                    <td key={ci} className={`px-2 py-1 text-center font-mono ${corrColor(v)}`}>
                      {ri === ci ? <span className="text-zinc-400">1.00</span> : v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-red-200 dark:bg-red-800/60" /> ≥0.7 High correlation</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-amber-100 dark:bg-amber-900/40" /> 0.4–0.7 Moderate</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200" /> &lt;0.4 Low (diversifying)</span>
          </div>
        </div>
      )}
      {fetched && data && data.symbols.length < 2 && (
        <p className="text-sm text-zinc-400">Need at least 2 holdings with price history to compute correlation.</p>
      )}
    </div>
  )
}

function RiskTab({ data }: { data: AssistantAnalysis }) {
  const { risk, summary } = data
  const riskColor = risk.level === 'High' ? 'text-red-500' : risk.level === 'Medium' ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Risk Level',        value: risk.level,                     color: riskColor },
          { label: 'Worst Position',    value: `${risk.worst_position_pct >= 0 ? '+' : ''}${risk.worst_position_pct?.toFixed(2) ?? '—'}%`, color: pnlColor(risk.worst_position_pct ?? 0) },
          { label: 'Best Position',     value: `+${risk.best_position_pct?.toFixed(2) ?? '—'}%`,  color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Concentration Risk',value: `${risk.concentration_risk?.toFixed(1) ?? '—'}%`,  color: (risk.concentration_risk ?? 0) > 40 ? 'text-red-500' : 'text-zinc-900 dark:text-zinc-50' },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-400">{m.label}</p>
            <p className={`mt-1 text-xl font-bold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Risk Analysis</p>
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
          <div className="flex items-start gap-2">
            <span className={`font-bold ${riskColor}`}>●</span>
            <p><strong>Risk Level: {risk.level}</strong> — Portfolio return dispersion (volatility proxy) is {risk.portfolio_volatility?.toFixed(1) ?? '—'}%. {risk.level === 'High' ? 'Consider reducing position sizes or cutting losers.' : risk.level === 'Medium' ? 'Acceptable for an active trader. Monitor closely.' : 'Well-managed risk profile.'}</p>
          </div>
          {(risk.concentration_risk ?? 0) > 30 && (
            <div className="flex items-start gap-2">
              <span className="font-bold text-amber-500">●</span>
              <p><strong>Concentration Risk:</strong> {risk.concentration_risk?.toFixed(1)}% in your largest sector. Reduce to below 30% for balanced risk.</p>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="font-bold text-indigo-500">●</span>
            <p><strong>Diversification:</strong> Score of {summary.diversification_score.toFixed(0)}/100. {summary.diversification_score < 50 ? 'Low — add more sectors.' : summary.diversification_score < 70 ? 'Moderate — room to improve.' : 'Good diversification across sectors.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function PerformanceTab({ data, portfolioId }: { data: AssistantAnalysis; portfolioId: string }) {
  const sorted = [...data.holdings].sort((a, b) => b.pnl_pct - a.pnl_pct)
  const winners = sorted.filter(h => h.pnl_pct > 0)
  const losers  = sorted.filter(h => h.pnl_pct < 0).reverse()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-emerald-500">Top Performers</p>
          {winners.length === 0 ? <p className="text-sm text-zinc-400">No profitable holdings yet.</p> : (
            <div className="space-y-2">
              {winners.slice(0, 5).map(h => (
                <div key={h.id} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</span>
                    <span className="ml-2 text-xs text-zinc-400">{h.sector}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{h.pnl_pct.toFixed(2)}%</span>
                    <span className="block text-xs text-emerald-500">+{fmtCr(h.pnl)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-red-400">Underperformers</p>
          {losers.length === 0 ? <p className="text-sm text-zinc-400">All holdings in profit!</p> : (
            <div className="space-y-2">
              {losers.slice(0, 5).map(h => (
                <div key={h.id} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</span>
                    <span className="ml-2 text-xs text-zinc-400">{h.sector}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-500">{h.pnl_pct.toFixed(2)}%</span>
                    <span className="block text-xs text-red-400">{fmtCr(h.pnl)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Technical Strength (from last AI scan)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
              {['Symbol', 'AI Score', 'AI Signal', 'Confidence', 'P&L'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {sorted.map(h => (
                <tr key={h.id}>
                  <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</td>
                  <td className="px-3 py-2">
                    {h.ai_score != null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className={cls('h-full rounded-full', h.ai_score >= 70 ? 'bg-indigo-500' : h.ai_score >= 50 ? 'bg-amber-400' : 'bg-red-400')}
                            style={{ width: `${h.ai_score}%` }} />
                        </div>
                        <span className="text-zinc-600 dark:text-zinc-300">{h.ai_score.toFixed(0)}</span>
                      </div>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {h.ai_signal ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLE[h.ai_signal] ?? SIGNAL_STYLE.NEUTRAL}`}>{h.ai_signal.replace('_', ' ')}</span> : '—'}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{h.ai_confidence != null ? `${(h.ai_confidence * 100).toFixed(0)}%` : '—'}</td>
                  <td className={`px-3 py-2 font-mono font-semibold ${pnlColor(h.pnl_pct)}`}>{h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TimelineSection portfolioId={portfolioId} />
    </div>
  )
}

// ── Portfolio Timeline (equity curve) ─────────────────────────────────────────

function TimelineSection({ portfolioId }: { portfolioId: string }) {
  const [tl, setTl] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('mts_token') ?? '' : ''
    if (!t) return
    setLoading(true)
    setTl(null)
    getAssistantTimeline(t, portfolioId).then(d => { setTl(d); setLoading(false) }).catch(() => setLoading(false))
  }, [portfolioId])

  if (loading) return <div className="h-36 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
  if (!tl || tl.dates.length === 0) return null

  const tlData = tl
  const maxVal = Math.max(...tlData.portfolio, ...tlData.nifty)
  const minVal = Math.min(...tlData.portfolio, ...tlData.nifty)
  const range = maxVal - minVal || 1
  const W = 700; const H = 140; const PAD = 10
  const n = tlData.dates.length

  const toY = (v: number) => PAD + (1 - (v - minVal) / range) * (H - PAD * 2)
  const toX = (i: number) => (i / (n - 1)) * W

  const portPath = tlData.portfolio.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const niftyPath = tlData.nifty.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

  const portFirst = tlData.portfolio[0] ?? 0
  const portFinal = tlData.portfolio[n - 1] ?? 0
  const portReturn = portFirst > 0 ? ((portFinal - portFirst) / portFirst) * 100 : 0
  const niftyFirst = tlData.nifty[0] ?? 0
  const niftyFinal = tlData.nifty[n - 1] ?? 0
  const niftyReturn = niftyFirst > 0 ? ((niftyFinal - niftyFirst) / niftyFirst) * 100 : 0

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Portfolio Timeline (6 months)</p>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-indigo-500" />Portfolio <span className={portReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{portReturn >= 0 ? '+' : ''}{portReturn.toFixed(1)}%</span></span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-zinc-400" />Nifty50 <span className={niftyReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{niftyReturn >= 0 ? '+' : ''}{niftyReturn.toFixed(1)}%</span></span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <path d={niftyPath} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={portPath} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
        <span>{tlData.dates[0]}</span>
        <span>{tlData.dates[n - 1]}</span>
      </div>
    </div>
  )
}

// ── Portfolio Summary Tab (Day / Week / Month) ────────────────────────────────
// The single-day view is date-pickable (see SummaryTab) rather than a fixed
// "Today" tab, so these only cover the rolling Week/Month periods.

const SUMMARY_PERIODS: { id: SummaryPeriod; label: string }[] = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
]

const SUGGESTION_STYLE: Record<string, string> = {
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  info: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
}

const SUGGESTION_ICON: Record<string, string> = { warning: '⚠️', info: '💡', positive: '✅' }

function PeriodSummaryContent({ summary }: { summary: AssistantPeriodSummary }) {
  return (
    <>
      {/* Headline: portfolio change vs Nifty/Sensex */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Portfolio Change</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(summary.portfolio_change_pct ?? 0))}>
            {(summary.portfolio_change_pct ?? 0) >= 0 ? '+' : ''}{(summary.portfolio_change_pct ?? 0).toFixed(2)}%
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {fmtCr(summary.portfolio_value_start ?? 0)} → {fmtCr(summary.portfolio_value_now ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Nifty50</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(summary.nifty_change_pct ?? 0))}>
            {summary.nifty_change_pct != null ? `${summary.nifty_change_pct >= 0 ? '+' : ''}${summary.nifty_change_pct.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {summary.nifty_value_start != null && summary.nifty_value_now != null
              ? `${summary.nifty_value_start.toLocaleString('en-IN')} → ${summary.nifty_value_now.toLocaleString('en-IN')}`
              : `${summary.start_date} → ${summary.end_date}`}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Sensex</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(summary.sensex_change_pct ?? 0))}>
            {summary.sensex_change_pct != null ? `${summary.sensex_change_pct >= 0 ? '+' : ''}${summary.sensex_change_pct.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {summary.sensex_value_start != null && summary.sensex_value_now != null
              ? `${summary.sensex_value_start.toLocaleString('en-IN')} → ${summary.sensex_value_now.toLocaleString('en-IN')}`
              : `${summary.start_date} → ${summary.end_date}`}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">vs Nifty50</p>
          <p className={cls('mt-1 text-2xl font-bold font-mono', pnlColor(summary.relative_pct ?? 0))}>
            {summary.relative_pct != null ? `${summary.relative_pct >= 0 ? '+' : ''}${summary.relative_pct.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {summary.relative_pct != null ? (summary.relative_pct >= 0 ? 'Outperforming' : 'Underperforming') : 'No benchmark data'}
          </p>
        </div>
      </div>

      {/* Suggestions */}
      <div className="space-y-2">
        {(summary.suggestions ?? []).map((s, i) => (
          <div key={i} className={cls('rounded-lg border px-3.5 py-2.5 text-sm', SUGGESTION_STYLE[s.severity])}>
            <span className="mr-2">{SUGGESTION_ICON[s.severity]}</span>{s.text}
          </div>
        ))}
      </div>

      {/* Winners / Losers — every holding, split by sign */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-emerald-500">
            Up This Period {(summary.winners ?? []).length > 0 && `(${(summary.winners ?? []).length})`}
          </p>
          {(summary.winners ?? []).length === 0 ? <p className="text-sm text-zinc-400">Nothing up this period.</p> : (
            <div className="space-y-2">
              {(summary.winners ?? []).map(h => (
                <div key={h.symbol} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</span>
                    <span className="ml-2 text-xs text-zinc-400">{h.sector}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{h.change_pct.toFixed(2)}%</span>
                    <span className="block text-xs text-zinc-400">₹{h.price_start.toFixed(2)} → ₹{h.price_now.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-red-400">
            Down This Period {(summary.losers ?? []).length > 0 && `(${(summary.losers ?? []).length})`}
          </p>
          {(summary.losers ?? []).length === 0 ? <p className="text-sm text-zinc-400">Nothing down this period.</p> : (
            <div className="space-y-2">
              {(summary.losers ?? []).map(h => (
                <div key={h.symbol} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{h.symbol.replace(/\.(NS|BO)$/, '')}</span>
                    <span className="ml-2 text-xs text-zinc-400">{h.sector}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-500">{h.change_pct.toFixed(2)}%</span>
                    <span className="block text-xs text-zinc-400">₹{h.price_start.toFixed(2)} → ₹{h.price_now.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sector moves */}
      {(summary.sector_moves ?? []).length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Sector Moves</p>
          <div className="space-y-2">
            {(summary.sector_moves ?? []).map(s => (
              <div key={s.sector} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">{s.sector}</span>
                  <span className="text-xs text-zinc-400">{s.weight_pct.toFixed(0)}% of portfolio</span>
                </div>
                <span className={cls('font-mono font-semibold', pnlColor(s.change_pct))}>
                  {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDayLabel(iso: string): string {
  if (iso === todayIso()) return 'Today'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function SummaryTab({ portfolioId }: { portfolioId: string }) {
  const [period, setPeriod] = useState<SummaryPeriod>('week')
  const [summary, setSummary] = useState<AssistantPeriodSummary | null>(null)
  const [loading, setLoading] = useState(true)
  // The single-day panel is always shown alongside whichever period (Week/
  // Month) is selected, driven by a date picker instead of a fixed "Today"
  // tab -- each trading day's numbers get stored server-side at market close
  // (see portfolio_summary_snapshots), so past dates stay looked-up-able
  // instead of only ever showing "now".
  const [dayDate, setDayDate] = useState<string>(todayIso)
  const [daySummary, setDaySummary] = useState<AssistantPeriodSummary | null>(null)
  const [dayLoading, setDayLoading] = useState(true)

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('mts_token') ?? '' : ''
    if (!t) return
    setLoading(true)
    getAssistantSummary(t, portfolioId, period).then(d => { setSummary(d); setLoading(false) }).catch(() => setLoading(false))
  }, [portfolioId, period])

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('mts_token') ?? '' : ''
    if (!t) return
    setDayLoading(true)
    getAssistantSummary(t, portfolioId, 'day', dayDate).then(d => { setDaySummary(d); setDayLoading(false) }).catch(() => setDayLoading(false))
  }, [portfolioId, dayDate])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SUMMARY_PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={cls(
              'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors',
              period === p.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Day:
          <input
            type="date"
            value={dayDate}
            max={todayIso()}
            onChange={e => setDayDate(e.target.value || todayIso())}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 dark:border-indigo-900 dark:bg-indigo-950/10">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          {formatDayLabel(dayDate)}
        </p>
        {dayLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        ) : !daySummary?.has_data ? (
          <p className="text-sm text-zinc-400">No data stored for this date.</p>
        ) : (
          <PeriodSummaryContent summary={daySummary} />
        )}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {SUMMARY_PERIODS.find(p => p.id === period)?.label}
      </p>

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ) : !summary?.has_data ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Add holdings to see a performance summary.</p>
        </div>
      ) : (
        <PeriodSummaryContent summary={summary} />
      )}
    </div>
  )
}

// ── OHLC Tab ──────────────────────────────────────────────────────────────────

function ohlcCell(value: number | null, pct: number | null, prefix = '₹') {
  if (value == null) return <span className="text-zinc-400">—</span>
  return (
    <div className="text-right">
      <span className={cls('font-mono font-semibold', pct != null ? pnlColor(pct) : '')}>
        {prefix}{value.toFixed(2)}
      </span>
      {pct != null && (
        <span className={cls('ml-1.5 font-mono text-xs', pnlColor(pct))}>
          ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
        </span>
      )}
    </div>
  )
}

function OhlcTab({ portfolioId }: { portfolioId: string }) {
  const [rows, setRows] = useState<OhlcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(true)

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('mts_token') ?? '' : ''
    if (!t) return
    setLoading(true)
    getAssistantOhlc(t, portfolioId)
      .then(d => { setRows(d.rows); setHasData(d.has_data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [portfolioId])

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      </div>
    )
  }

  if (!hasData || rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Add holdings to see OHLC data.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Refreshed live from the latest trading day for each holding &mdash; {rows[0]?.date}.
        52-week high/low and weekly/monthly change are trailing windows ending on that date.
      </p>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {['Symbol', 'Open', 'High', 'Low', 'Close', 'Change', '52W High', '52W Low', 'Weekly', 'Monthly'].map((h, i) => (
                <th key={h} className={cls('px-3 py-2 font-medium text-zinc-500', i === 0 ? 'text-left' : 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
            {rows.map(r => (
              <tr key={r.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol.replace(/\.(NS|BO)$/, '')}</span>
                  <span className="ml-2 text-[10px] text-zinc-400">{r.sector}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">{r.open != null ? r.open.toFixed(2) : '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">{r.high != null ? r.high.toFixed(2) : '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">{r.low != null ? r.low.toFixed(2) : '—'}</td>
                <td className="px-3 py-2.5">{ohlcCell(r.close, null)}</td>
                <td className="px-3 py-2.5">{ohlcCell(r.change, r.change_pct)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">{r.week_52_high != null ? r.week_52_high.toFixed(2) : '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">{r.week_52_low != null ? r.week_52_low.toFixed(2) : '—'}</td>
                <td className="px-3 py-2.5">{ohlcCell(r.weekly_change, r.weekly_change_pct)}</td>
                <td className="px-3 py-2.5">{ohlcCell(r.monthly_change, r.monthly_change_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Research Tab ─────────────────────────────────────────────────────────────

function FundamentalsSection({ portfolioId }: { portfolioId: string }) {
  const [rows, setRows] = useState<FundamentalRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantFundamentals(t, portfolioId).then(d => { setRows(d); setFetched(true); setLoading(false) }).catch(() => setLoading(false))
  }

  const fmtMCap = (v: number | null) => {
    if (!v) return '—'
    if (v >= 1e12) return `₹${(v / 1e12).toFixed(1)}T`
    if (v >= 1e9) return `₹${(v / 1e9).toFixed(1)}B`
    return `₹${(v / 1e7).toFixed(0)}Cr`
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Fundamental Health</p>
        {!fetched && <button onClick={load} disabled={loading} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{loading ? 'Fetching…' : 'Load Fundamentals'}</button>}
      </div>
      {!fetched && !loading && <p className="text-xs text-zinc-400">Click Load Fundamentals to fetch P/E, P/B, ROE, beta and analyst targets from yfinance.</p>}
      {loading && <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
      {fetched && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
              {['Symbol', 'Market Cap', 'P/E', 'P/B', 'ROE %', 'Beta', 'Div Yield', 'Analyst', 'D/E'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {rows.map(r => (
                <tr key={r.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</p>
                    <p className="text-[10px] text-zinc-400">{r.industry}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{fmtMCap(r.market_cap)}</td>
                  <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-200">{r.pe_ratio?.toFixed(1) ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-200">{r.pb_ratio?.toFixed(2) ?? '—'}</td>
                  <td className={`px-3 py-2 font-mono font-semibold ${(r.roe ?? 0) >= 15 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-300'}`}>{r.roe != null ? `${r.roe}%` : '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.beta ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.dividend_yield != null ? `${r.dividend_yield}%` : '—'}</td>
                  <td className="px-3 py-2">
                    {r.recommendation !== '—' ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.recommendation.toLowerCase().includes('buy') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : r.recommendation.toLowerCase().includes('sell') ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                        {r.recommendation}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{r.debt_to_equity ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DividendSection({ portfolioId }: { portfolioId: string }) {
  const [rows, setRows] = useState<DividendRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantDividends(t, portfolioId).then(d => { setRows(d); setFetched(true); setLoading(false) }).catch(() => setLoading(false))
  }

  const nonZero = rows.filter(r => r.dividends.length > 0 || r.current_yield > 0)

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Dividend Analysis</p>
        {!fetched && <button onClick={load} disabled={loading} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{loading ? 'Fetching…' : 'Load Dividends'}</button>}
      </div>
      {!fetched && !loading && <p className="text-xs text-zinc-400">Fetch historical dividends, yield-on-cost, and estimated annual income per holding.</p>}
      {loading && <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
      {fetched && (
        nonZero.length === 0
          ? <p className="text-sm text-zinc-400">No dividend history found for your holdings. These may be growth stocks or dividends not yet declared.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {['Symbol', 'Current Yield', 'Yield on Cost', 'Annual Income Est.', 'Total Received Est.', 'Recent Payouts'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                  {rows.map(r => (
                    <tr key={r.symbol}>
                      <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.current_yield > 0 ? `${r.current_yield}%` : '—'}</td>
                      <td className={`px-3 py-2 font-semibold ${r.yield_on_cost >= 3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>{r.yield_on_cost > 0 ? `${r.yield_on_cost}%` : '—'}</td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{r.annual_income_est > 0 ? fmtCr(r.annual_income_est) : '—'}</td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{r.total_received_est > 0 ? fmtCr(r.total_received_est) : '—'}</td>
                      <td className="px-3 py-2 text-zinc-400">
                        {r.dividends.slice(-3).map(d => `₹${d.amount} (${d.date.slice(0, 7)})`).join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </div>
  )
}

function TaxSection({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<TaxData | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantTax(t, portfolioId).then(d => { setData(d); setFetched(true); setLoading(false) }).catch(() => setLoading(false))
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Tax Analysis (STCG / LTCG)</p>
        {!fetched && <button onClick={load} disabled={loading} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{loading ? 'Computing…' : 'Compute Tax'}</button>}
      </div>
      {!fetched && !loading && <p className="text-xs text-zinc-400">Compute estimated STCG (20%) and LTCG (12.5%) liability per holding per Budget 2024 rules.</p>}
      {loading && <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
      {fetched && data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'STCG P&L', v: data.summary.total_stcg, tax: data.summary.stcg_tax, rate: '20%' },
              { label: 'LTCG P&L', v: data.summary.total_ltcg, tax: data.summary.ltcg_tax, rate: '12.5%' },
            ].map(s => (
              <div key={s.label} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800">
                <p className="text-[10px] text-zinc-400">{s.label} ({s.rate})</p>
                <p className={`mt-0.5 text-sm font-bold ${s.v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{s.v >= 0 ? '+' : ''}{fmtCr(s.v)}</p>
                <p className="text-[10px] text-zinc-400">Tax: {fmtCr(s.tax)}</p>
              </div>
            ))}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30 sm:col-span-2">
              <p className="text-[10px] text-amber-600 dark:text-amber-400">Estimated Total Tax</p>
              <p className="mt-0.5 text-sm font-bold text-amber-700 dark:text-amber-300">{fmtCr(data.summary.total_tax)}</p>
              <p className="text-[10px] text-amber-500">LTCG exemption used: {fmtCr(data.summary.ltcg_exemption_used)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Symbol', 'Qty', 'Avg', 'CMP', 'P&L', 'Days Held', 'Type', 'Rate', 'Est. Tax'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {data.rows.map(r => (
                  <tr key={r.symbol}>
                    <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.qty}</td>
                    <td className="px-3 py-2 font-mono text-zinc-500">₹{fmt(r.avg_price)}</td>
                    <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-200">₹{fmt(r.current_price)}</td>
                    <td className={`px-3 py-2 font-mono font-semibold ${pnlColor(r.pnl)}`}>{r.pnl >= 0 ? '+' : ''}{fmtCr(r.pnl)}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.days_held != null ? `${r.days_held}d` : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.tax_type === 'LTCG' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : r.tax_type === 'STCG' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-zinc-100 text-zinc-500'}`}>
                        {r.tax_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{r.tax_rate > 0 ? `${r.tax_rate}%` : '—'}</td>
                    <td className={`px-3 py-2 font-mono font-semibold ${r.estimated_tax > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>{r.estimated_tax > 0 ? fmtCr(r.estimated_tax) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">{data.summary.note}</p>
        </>
      )}
    </div>
  )
}

// ── News Sentiment Section (Phase 2) ──────────────────────────────────────────

function SentimentSection({ portfolioId }: { portfolioId: string }) {
  const [rows, setRows] = useState<SentimentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantSentiment(t, portfolioId)
      .then(d => { setRows(d); setFetched(true); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function sentColor(avg: number) {
    if (avg > 0.2) return 'text-emerald-600 dark:text-emerald-400'
    if (avg < -0.2) return 'text-red-500 dark:text-red-400'
    return 'text-zinc-500 dark:text-zinc-400'
  }

  function sentBar(avg: number) {
    const pct = Math.round(((avg + 1) / 2) * 100)
    const col = avg > 0.2 ? 'bg-emerald-500' : avg < -0.2 ? 'bg-red-500' : 'bg-zinc-400'
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className={`h-full rounded-full ${col}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-semibold ${sentColor(avg)}`}>{avg > 0 ? '+' : ''}{avg.toFixed(2)}</span>
      </div>
    )
  }

  const hasData = rows.some(r => r.news_count > 0)
  const portAvg = hasData
    ? rows.filter(r => r.news_count > 0).reduce((s, r) => s + r.avg_sentiment, 0) /
      rows.filter(r => r.news_count > 0).length
    : 0

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">News Sentiment</p>
          {fetched && hasData && (
            <p className={`text-xs mt-0.5 font-semibold ${sentColor(portAvg)}`}>
              Portfolio: {portAvg > 0 ? 'Bullish' : portAvg < -0.2 ? 'Bearish' : 'Neutral'} ({portAvg > 0 ? '+' : ''}{portAvg.toFixed(2)})
            </p>
          )}
        </div>
        {!fetched && (
          <button onClick={load} disabled={loading}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Fetching…' : 'Load Sentiment'}
          </button>
        )}
      </div>

      {!fetched && !loading && (
        <p className="text-xs text-zinc-400">Recent news sentiment from the AI Discovery engine, scored per holding.</p>
      )}
      {loading && <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}

      {fetched && rows.length === 0 && (
        <p className="text-sm text-zinc-400">No holdings found in this portfolio.</p>
      )}

      {fetched && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.symbol} className="rounded-lg border border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <div className="flex items-center gap-3">
                  <span className="min-w-[60px] text-sm font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    r.sentiment_label.includes('Bullish') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                    r.sentiment_label.includes('Bearish') ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                    r.sentiment_label === 'No Data' ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' :
                    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>{r.sentiment_label}</span>
                </div>
                <div className="flex items-center gap-4">
                  {r.news_count > 0 ? (
                    <>
                      {sentBar(r.avg_sentiment)}
                      <div className="flex gap-2 text-[10px]">
                        <span className="text-emerald-600">▲{r.bullish_count}</span>
                        <span className="text-zinc-400">—{r.neutral_count}</span>
                        <span className="text-red-500">▼{r.bearish_count}</span>
                      </div>
                      <span className="text-xs text-zinc-400">{r.news_count} articles</span>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-400">No news found</span>
                  )}
                  <span className="text-zinc-400">{expanded === r.symbol ? '▲' : '▼'}</span>
                </div>
              </button>

              {expanded === r.symbol && r.headlines.length > 0 && (
                <div className="border-t border-zinc-100 px-3 pb-3 dark:border-zinc-800">
                  <div className="mt-2 space-y-2">
                    {r.headlines.map((h, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${h.sentiment_score > 0.2 ? 'bg-emerald-500' : h.sentiment_score < -0.2 ? 'bg-red-500' : 'bg-zinc-400'}`} />
                        <div className="min-w-0 flex-1">
                          {h.url ? (
                            <a href={h.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-zinc-800 hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-400 line-clamp-2">
                              {h.title}
                            </a>
                          ) : (
                            <p className="text-xs text-zinc-800 dark:text-zinc-200 line-clamp-2">{h.title}</p>
                          )}
                          <p className="mt-0.5 text-[10px] text-zinc-400">{h.source} · {h.published_at}</p>
                        </div>
                        <span className={`flex-shrink-0 text-[10px] font-mono ${sentColor(h.sentiment_score)}`}>
                          {h.sentiment_score > 0 ? '+' : ''}{h.sentiment_score.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {expanded === r.symbol && r.headlines.length === 0 && r.news_count === 0 && (
                <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <p className="text-xs text-zinc-400">No news articles found. Run a Discovery scan to populate news data.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AI Signals Section (Phase 2) ──────────────────────────────────────────────

function AISignalsSection({ portfolioId }: { portfolioId: string }) {
  const [rows, setRows] = useState<AISignalRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    getAssistantAISignals(t, portfolioId)
      .then(d => { setRows(d); setFetched(true); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function actionColor(signal: string) {
    if (signal === 'STRONG_BUY') return 'text-emerald-700 dark:text-emerald-300'
    if (signal === 'BUY') return 'text-green-600 dark:text-green-400'
    if (signal === 'SELL') return 'text-red-500 dark:text-red-400'
    if (signal === 'STRONG_SELL') return 'text-red-700 dark:text-red-300'
    return 'text-zinc-500 dark:text-zinc-400'
  }

  function actionHint(signal: string, avgPrice: number, stopLoss: number, targets: number[]) {
    if (signal === 'NO_DATA') return 'Run Discovery scan to get AI signals.'
    const t1 = targets[0] ?? 0
    if (signal === 'STRONG_BUY' || signal === 'BUY') {
      return `Add more. Target ₹${t1 > 0 ? t1.toFixed(0) : '—'}, stop ₹${stopLoss > 0 ? stopLoss.toFixed(0) : '—'}.`
    }
    if (signal === 'SELL' || signal === 'STRONG_SELL') {
      return `Consider exiting. Avg ₹${avgPrice.toFixed(0)}, stop ₹${stopLoss > 0 ? stopLoss.toFixed(0) : '—'}.`
    }
    return `Hold. Target ₹${t1 > 0 ? t1.toFixed(0) : '—'}.`
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">AI Signals (Discovery Engine)</p>
        {!fetched && (
          <button onClick={load} disabled={loading}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Loading…' : 'Load AI Signals'}
          </button>
        )}
      </div>

      {!fetched && !loading && (
        <p className="text-xs text-zinc-400">Latest buy/sell signals from the AI engine for each holding — entry, stop-loss, and targets.</p>
      )}
      {loading && <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}

      {fetched && rows.length === 0 && (
        <p className="text-sm text-zinc-400">No holdings found in this portfolio.</p>
      )}

      {fetched && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Symbol', 'Signal', 'Score', 'Entry ₹', 'Stop ₹', 'Target ₹', 'Tech', 'News', 'Action'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {rows.map(r => (
                <tr key={r.symbol} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</p>
                    {r.scanned_at && <p className="text-[10px] text-zinc-400">{r.scanned_at}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SIGNAL_STYLE[r.signal] ?? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>
                      {r.signal === 'NO_DATA' ? 'No Data' : r.signal.replace('_', ' ')}
                    </span>
                    {r.confidence > 0 && (
                      <p className="mt-0.5 text-[10px] text-zinc-400">{(r.confidence * 100).toFixed(0)}% conf</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.score > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className={`h-full rounded-full ${r.score >= 70 ? 'bg-indigo-500' : r.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${r.score}%` }} />
                        </div>
                        <span className="font-mono text-zinc-600 dark:text-zinc-300">{r.score}</span>
                      </div>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-200">{r.entry_price > 0 ? r.entry_price.toFixed(0) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-red-500">{r.stop_loss > 0 ? r.stop_loss.toFixed(0) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">{r.targets.length > 0 ? r.targets[0].toFixed(0) : '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.technical_score > 0 ? r.technical_score.toFixed(0) : '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.news_score > 0 ? r.news_score.toFixed(0) : '—'}</td>
                  <td className={`px-3 py-2 max-w-[140px] ${actionColor(r.signal)}`}>
                    <p className="text-[10px] font-semibold">{actionHint(r.signal, r.avg_price, r.stop_loss, r.targets)}</p>
                    {r.holding_period && <p className="text-[10px] text-zinc-400">Hold: {r.holding_period}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Broker Connect Section (Phase 3) ──────────────────────────────────────────

function BrokerConnectSection({ portfolioId, onImported }: { portfolioId: string; onImported: () => void }) {
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null)
  const [positions, setPositions] = useState<BrokerPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  function load() {
    const t = localStorage.getItem('mts_token') ?? ''
    setLoading(true)
    Promise.all([getBrokerStatus(t), getBrokerPositions(t)])
      .then(([status, pos]) => {
        setBrokerStatus(status)
        setPositions(pos)
        setFetched(true)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  async function importAll() {
    if (positions.length === 0) return
    const t = localStorage.getItem('mts_token') ?? ''
    setImporting(true)
    setResult(null)
    let ok = 0; let fail = 0
    for (const p of positions) {
      try {
        const sym = p.symbol.includes('.') ? p.symbol : `${p.symbol}.NS`
        await addHolding(t, { symbol: sym, qty: p.qty, avg_price: p.avg_price, portfolio_id: portfolioId })
        ok++
      } catch { fail++ }
    }
    setImporting(false)
    setResult(`Imported ${ok} position${ok !== 1 ? 's' : ''}${fail > 0 ? `, ${fail} failed` : ''} into "${portfolioId}".`)
    if (ok > 0) onImported()
  }

  const brokerLabel: Record<string, string> = {
    zerodha: 'Zerodha Kite',
    upstox: 'Upstox',
    simulated: 'Simulated',
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Broker Connect</p>
          {brokerStatus && (
            <p className="mt-0.5 text-xs text-zinc-500">
              Connected: <span className="font-semibold capitalize text-zinc-900 dark:text-zinc-50">
                {brokerLabel[brokerStatus.broker] ?? brokerStatus.broker}
              </span>
              <span className={`ml-2 inline-block h-1.5 w-1.5 rounded-full ${brokerStatus.connected ? 'bg-emerald-500' : 'bg-red-400'}`} />
            </p>
          )}
        </div>
        {!fetched && (
          <button onClick={load} disabled={loading}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Loading…' : 'Load Positions'}
          </button>
        )}
      </div>

      {!fetched && !loading && (
        <p className="text-xs text-zinc-400">
          Auto-import live positions from Zerodha or Upstox into this portfolio. Configure your broker on the{' '}
          <a href="/broker" className="text-indigo-600 hover:underline dark:text-indigo-400">Broker page</a>.
        </p>
      )}
      {loading && <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}

      {fetched && positions.length === 0 && (
        <div className="text-xs text-zinc-400">
          <p>No open positions found in your connected broker ({brokerLabel[brokerStatus?.broker ?? ''] ?? brokerStatus?.broker}).</p>
          {brokerStatus?.broker === 'simulated' && (
            <p className="mt-1">Connect Zerodha or Upstox on the <a href="/broker" className="text-indigo-600 hover:underline dark:text-indigo-400">Broker page</a> to import real positions.</p>
          )}
        </div>
      )}

      {fetched && positions.length > 0 && (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Symbol', 'Qty', 'Avg Price ₹', 'Broker'].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-medium text-zinc-500">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {positions.map((p, i) => (
                  <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="px-2 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{p.symbol.replace(/\.(NS|BO)$/, '')}</td>
                    <td className="px-2 py-2 text-zinc-600 dark:text-zinc-300">{p.qty}</td>
                    <td className="px-2 py-2 font-mono text-zinc-700 dark:text-zinc-200">₹{p.avg_price.toFixed(2)}</td>
                    <td className="px-2 py-2 capitalize text-zinc-400">{brokerLabel[p.broker] ?? p.broker}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{result}</p>
          )}

          <button
            onClick={importAll}
            disabled={importing || !!result}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {importing ? 'Importing…' : `Import ${positions.length} position${positions.length !== 1 ? 's' : ''} → "${portfolioId}"`}
          </button>
        </div>
      )}
    </div>
  )
}

function ResearchTab({ data, portfolioId, onHoldingsChanged }: { data: AssistantAnalysis; portfolioId: string; onHoldingsChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">News Impact</p>
        <p className="text-sm text-zinc-500 mb-3">Recent AI scan coverage for your holdings. Visit Discovery for full analysis.</p>
        <div className="flex flex-wrap gap-2">
          {data.holdings.map(h => (
            <a key={h.id} href={`/discovery?symbol=${h.symbol}`}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {h.symbol.replace(/\.(NS|BO)$/, '')} →
            </a>
          ))}
        </div>
      </div>

      <FundamentalsSection portfolioId={portfolioId} />
      <DividendSection portfolioId={portfolioId} />
      <TaxSection portfolioId={portfolioId} />

      <AISignalsSection portfolioId={portfolioId} />
      <SentimentSection portfolioId={portfolioId} />
      <BrokerConnectSection portfolioId={portfolioId} onImported={onHoldingsChanged} />
    </div>
  )
}

// ── AI Portfolio Assistant Chat ────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  'Why is my portfolio underperforming?',
  'Which holding is the riskiest?',
  'Which stock should I sell first?',
  'Where should I invest ₹1 lakh today?',
  'How can I improve diversification?',
  'Which positions have the highest downside risk?',
  'What is my expected return over the next 6 months?',
]

type ChatMsg = { role: 'user' | 'ai'; text: string }

function AssistantTab({ token, portfolioId }: { token: string; portfolioId: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'ai', text: 'Hello! I\'m your Portfolio Assistant. Ask me anything about your holdings — performance, risk, what to buy or sell, diversification, and more.' }
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(question: string) {
    if (!question.trim() || thinking) return
    setMessages(m => [...m, { role: 'user', text: question }])
    setInput('')
    setThinking(true)
    try {
      const { answer } = await askAssistant(token, question, portfolioId)
      setMessages(m => [...m, { role: 'ai', text: answer }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Sorry, I couldn\'t fetch your portfolio data right now. Please try again.' }])
    } finally { setThinking(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {QUICK_QUESTIONS.map(q => (
          <button key={q} onClick={() => send(q)} disabled={thinking}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40">
            {q}
          </button>
        ))}
      </div>

      <div className="flex h-96 flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={cls('flex gap-3', m.role === 'user' ? 'justify-end' : '')}>
              {m.role === 'ai' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" /></svg>
                </div>
              )}
              <div className={cls(
                'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
                m.role === 'ai'
                  ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                  : 'bg-indigo-600 text-white'
              )}>
                {m.text.split(/(\*\*[^*]+\*\*)/).map((part, pi) =>
                  part.startsWith('**') ? <strong key={pi}>{part.slice(2, -2)}</strong> : <span key={pi}>{part}</span>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
              <div className="rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-500 dark:bg-zinc-800">Analysing your portfolio…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
          <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask anything about your portfolio…"
              className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" />
            <button type="submit" disabled={!input.trim() || thinking}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'holdings' | 'allocation' | 'risk' | 'performance' | 'research' | 'summary' | 'ohlc' | 'assistant'

const TABS: { id: Tab; label: string; count?: (d: AssistantAnalysis) => number }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'holdings',   label: 'Holdings', count: d => d.holdings.length },
  { id: 'allocation', label: 'Allocation' },
  { id: 'risk',       label: 'Risk' },
  { id: 'performance',label: 'Performance' },
  { id: 'research',   label: 'Research' },
  { id: 'summary',    label: 'Summary' },
  { id: 'ohlc',       label: 'OHLC' },
  { id: 'assistant',  label: 'AI Assistant' },
]

export default function AssistantView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [data, setData]               = useState<AssistantAnalysis | null>(null)
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<Tab>('overview')
  const [showAdd, setShowAdd]         = useState(false)
  const [portfolios, setPortfolios]   = useState<Portfolio[]>([])
  const [activePortfolioId, setActivePortfolioId] = useState('default')
  const [showNewPortfolio, setShowNewPortfolio]   = useState(false)
  const [watchlists, setWatchlists]   = useState<Watchlist[]>([])

  async function loadPortfolios(token: string) {
    const ps = await listPortfolios(token).catch(() => [] as Portfolio[])
    setPortfolios(ps)
    // If we have portfolios and active is still "default" but not in the list, pick first
    if (ps.length > 0 && !ps.find(p => p.portfolio_id === activePortfolioId)) {
      setActivePortfolioId(ps[0].portfolio_id)
    }
    return ps
  }

  async function loadData(token: string, portfolioId: string) {
    setLoading(true)
    const d = await getAssistantAnalysis(token, portfolioId).catch(() => null)
    setData(d)
    setLoading(false)
  }

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    listWatchlists(t).then(setWatchlists).catch(() => {})
    loadPortfolios(t).then(ps => {
      const pid = ps.length > 0 ? ps[0].portfolio_id : 'default'
      setActivePortfolioId(pid)
      loadData(t, pid)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  function refresh() { loadData(tokenRef.current, activePortfolioId) }

  function switchPortfolio(id: string) {
    if (id === activePortfolioId) return
    setActivePortfolioId(id)
    setTab('overview')
    loadData(tokenRef.current, id)
  }

  async function handleDeletePortfolio(id: string) {
    await deletePortfolio(tokenRef.current, id).catch(() => null)
    const ps = await loadPortfolios(tokenRef.current)
    const fallback = ps.find(p => p.portfolio_id !== id)?.portfolio_id ?? 'default'
    setActivePortfolioId(fallback)
    loadData(tokenRef.current, fallback)
  }

  function handlePortfolioCreated(p: Portfolio) {
    setShowNewPortfolio(false)
    setPortfolios(prev => [...prev, p])
    setActivePortfolioId(p.portfolio_id)
    setTab('overview')
    loadData(tokenRef.current, p.portfolio_id)
  }

  const isEmpty = !loading && data && data.holdings.length === 0

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Portfolio" />
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Portfolio Assistant</h1>
            <p className="text-xs text-zinc-400">Track your real holdings · AI analysis · Multiple portfolios</p>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            {showAdd ? '✕ Cancel' : '+ Add Holding'}
          </button>
        </div>

        {/* Portfolio Switcher */}
        {portfolios.length > 0 && (
          <PortfolioSwitcher
            portfolios={portfolios}
            active={activePortfolioId}
            onSwitch={switchPortfolio}
            onNew={() => setShowNewPortfolio(true)}
            onDelete={handleDeletePortfolio}
          />
        )}
        {portfolios.length === 0 && !loading && (
          <div className="mb-5 flex items-center gap-2">
            <button onClick={() => setShowNewPortfolio(true)}
              className="flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400">
              + New Portfolio
            </button>
          </div>
        )}

        {/* New portfolio modal */}
        {showNewPortfolio && (
          <NewPortfolioModal
            token={tokenRef.current}
            onCreated={handlePortfolioCreated}
            onCancel={() => setShowNewPortfolio(false)}
          />
        )}

        {/* Add / Import panel */}
        {showAdd && (
          <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-950/20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-indigo-500">
              Add Holdings to &ldquo;{portfolios.find(p => p.portfolio_id === activePortfolioId)?.name ?? activePortfolioId}&rdquo;
            </p>
            <AddHoldingForm token={tokenRef.current} portfolioId={activePortfolioId} onAdded={() => { refresh(); setShowAdd(false); loadPortfolios(tokenRef.current) }} />
            <div className="mt-3 border-t border-indigo-200 pt-3 dark:border-indigo-800">
              <CsvImport token={tokenRef.current} portfolioId={activePortfolioId} onImported={() => { refresh(); setShowAdd(false); loadPortfolios(tokenRef.current) }} />
            </div>
            <p className="mt-3 text-[11px] text-zinc-400">
              CSV columns: <code>symbol, qty, avg_price, buy_date (optional), name (optional)</code>.<br />
              Symbols without exchange suffix (.NS / .BO) default to NSE.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {isEmpty && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No holdings in this portfolio</p>
            <p className="mt-1 text-xs text-zinc-400">Click &ldquo;+ Add Holding&rdquo; to add stocks manually, or import a CSV.</p>
          </div>
        )}

        {!loading && data && data.holdings.length > 0 && (
          <>
            {/* Tab bar */}
            <div className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cls(
                    'flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    tab === t.id
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
                  )}>
                  {t.label}
                  {t.count && <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] dark:bg-zinc-700">{t.count(data)}</span>}
                </button>
              ))}
            </div>

            {tab === 'overview'    && <OverviewTab data={data} />}
            {tab === 'holdings'   && <HoldingsTab data={data} token={tokenRef.current} watchlists={watchlists} onRefresh={refresh} />}
            {tab === 'allocation' && <AllocationTab data={data} portfolioId={activePortfolioId} />}
            {tab === 'risk'       && <RiskTab data={data} />}
            {tab === 'performance'&& <PerformanceTab data={data} portfolioId={activePortfolioId} />}
            {tab === 'research'   && <ResearchTab data={data} portfolioId={activePortfolioId} onHoldingsChanged={refresh} />}
            {tab === 'summary'    && <SummaryTab portfolioId={activePortfolioId} />}
            {tab === 'ohlc'       && <OhlcTab portfolioId={activePortfolioId} />}
            {tab === 'assistant'  && <AssistantTab token={tokenRef.current} portfolioId={activePortfolioId} />}
          </>
        )}
      </main>
    </div>
  )
}

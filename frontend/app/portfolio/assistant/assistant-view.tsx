'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getAssistantAnalysis, addHolding, deleteHolding, importHoldings, askAssistant,
} from '@/lib/api'
import type { AssistantAnalysis, Holding, AssistantAlert, SizingRow } from '@/lib/api'

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

function Phase2Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-800/20">
      <span className="mb-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">Phase 2</span>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      <p className="mt-1 text-xs text-zinc-400">{description}</p>
    </div>
  )
}

// ── Add Holding Form ───────────────────────────────────────────────────────────

function AddHoldingForm({ token, onAdded }: { token: string; onAdded: () => void }) {
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
      await addHolding(token, { symbol: sym.trim(), qty: Number(qty), avg_price: Number(price), buy_date: date || undefined })
      setSym(''); setQty(''); setPrice(''); setDate('')
      onAdded()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <input value={sym} onChange={e => setSym(e.target.value)} placeholder="Symbol (e.g. SBIN)" required
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 sm:col-span-1" />
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

function CsvImport({ token, onImported }: { token: string; onImported: () => void }) {
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
        const { imported } = await importHoldings(token, rows)
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
              {alerts.map((a, i) => (
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

      {/* Portfolio Scorecard */}
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

function HoldingsTab({ data, token, onRefresh }: { data: AssistantAnalysis; token: string; onRefresh: () => void }) {
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
            {['Symbol', 'Qty', 'Avg Price', 'CMP', 'Invested', 'Curr Value', 'P&L', 'AI Signal', 'Recommendation', ''].map(h => (
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

function AllocationTab({ data }: { data: AssistantAnalysis }) {
  const { sector_allocation, summary, sizing } = data
  const slices = Object.entries(sector_allocation).map(([label, value]) => ({ label, value }))
  const total = summary.current_value

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Asset Allocation */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-400">Asset Allocation by Sector</p>
          <MiniDonut data={slices} />
        </div>

        {/* Sector bar chart */}
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

      {/* Position Sizing */}
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

      <Phase2Card title="Correlation Matrix" description="Shows how your holdings move together. Helps identify true diversification. Coming in Phase 2." />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Phase2Card title="Monte Carlo Simulation" description="10,000 portfolio paths to estimate probability of gain/loss over 1–12 months. Phase 2." />
        <Phase2Card title="Value at Risk (VaR)" description="Statistical worst-case daily loss at 95% confidence. Requires price history. Phase 2." />
      </div>
    </div>
  )
}

function PerformanceTab({ data }: { data: AssistantAnalysis }) {
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Phase2Card title="Portfolio Timeline" description="Equity curve of portfolio value over time. Requires historical price data. Phase 2." />
        <Phase2Card title="Dividend Analysis" description="Track dividends received, yield on cost, upcoming ex-dates. Phase 2." />
        <Phase2Card title="Tax Analysis" description="STCG/LTCG computation, tax-loss harvesting suggestions. Phase 2." />
      </div>
    </div>
  )
}

function ResearchTab({ data }: { data: AssistantAnalysis }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">News Impact</p>
        <p className="text-sm text-zinc-500 mb-3">Recent AI scan news for your holdings. Visit the Discovery page for full coverage.</p>
        <div className="flex flex-wrap gap-2">
          {data.holdings.map(h => (
            <a key={h.id} href={`/discovery?symbol=${h.symbol}`}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {h.symbol.replace(/\.(NS|BO)$/, '')}
            </a>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Phase2Card title="AI Price Prediction" description="ML model 1-day, 1-week, 1-month price targets per holding. Phase 2." />
        <Phase2Card title="Social Sentiment" description="Reddit, Twitter/X, YouTube sentiment aggregation per stock. Phase 2." />
        <Phase2Card title="Fundamental Health" description="P/E, P/B, ROE, debt ratios, earnings growth per holding. Phase 2." />
        <Phase2Card title="Historical Backtesting" description="Test if your current portfolio would have outperformed the index. Phase 2." />
        <Phase2Card title="Broker Connect" description="Auto-import live positions from Zerodha Kite, Upstox, AngelOne. Phase 3." />
        <Phase2Card title="Options Analysis" description="If you hold options/F&O, track Greeks and P&L. Phase 3." />
      </div>
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

function AssistantTab({ token }: { token: string }) {
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
      const { answer } = await askAssistant(token, question)
      setMessages(m => [...m, { role: 'ai', text: answer }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Sorry, I couldn\'t fetch your portfolio data right now. Please try again.' }])
    } finally { setThinking(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quick questions */}
      <div className="flex flex-wrap gap-2">
        {QUICK_QUESTIONS.map(q => (
          <button key={q} onClick={() => send(q)} disabled={thinking}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40">
            {q}
          </button>
        ))}
      </div>

      {/* Chat window */}
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
                {/* Render **bold** markdown */}
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

type Tab = 'overview' | 'holdings' | 'allocation' | 'risk' | 'performance' | 'research' | 'assistant'

const TABS: { id: Tab; label: string; count?: (d: AssistantAnalysis) => number }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'holdings',   label: 'Holdings', count: d => d.holdings.length },
  { id: 'allocation', label: 'Allocation' },
  { id: 'risk',       label: 'Risk' },
  { id: 'performance',label: 'Performance' },
  { id: 'research',   label: 'Research' },
  { id: 'assistant',  label: 'AI Assistant' },
]

export default function AssistantView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [data, setData]           = useState<AssistantAnalysis | null>(null)
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<Tab>('overview')
  const [showAdd, setShowAdd]     = useState(false)

  async function load(token: string) {
    const d = await getAssistantAnalysis(token).catch(() => null)
    if (d) { setData(d); setLoading(false) }
    else setLoading(false)
  }

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    load(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  function refresh() { load(tokenRef.current) }

  const isEmpty = !loading && data && data.holdings.length === 0

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Portfolio" />
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Portfolio Assistant</h1>
            <p className="text-xs text-zinc-400">Track your real holdings · AI analysis · 23 insights</p>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            {showAdd ? '✕ Cancel' : '+ Add Holding'}
          </button>
        </div>

        {/* Add / Import panel */}
        {showAdd && (
          <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-950/20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-indigo-500">Add Holdings</p>
            <AddHoldingForm token={tokenRef.current} onAdded={() => { refresh(); setShowAdd(false) }} />
            <div className="mt-3 border-t border-indigo-200 pt-3 dark:border-indigo-800">
              <CsvImport token={tokenRef.current} onImported={() => { refresh(); setShowAdd(false) }} />
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
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No holdings yet</p>
            <p className="mt-1 text-xs text-zinc-400">Click "+ Add Holding" to add stocks manually, or import a CSV.</p>
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
            {tab === 'holdings'   && <HoldingsTab data={data} token={tokenRef.current} onRefresh={refresh} />}
            {tab === 'allocation' && <AllocationTab data={data} />}
            {tab === 'risk'       && <RiskTab data={data} />}
            {tab === 'performance'&& <PerformanceTab data={data} />}
            {tab === 'research'   && <ResearchTab data={data} />}
            {tab === 'assistant'  && <AssistantTab token={tokenRef.current} />}
          </>
        )}
      </main>
    </div>
  )
}

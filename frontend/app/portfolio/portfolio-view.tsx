'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getPortfolio, saveJournalEntry, getJournalEntry } from '@/lib/api'
import type { PortfolioData, PortfolioPosition, PortfolioClosedTrade } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'
import { EquityChart } from '@/components/equity-chart'
import { DonutChart } from '@/components/donut-chart'

function pnlClass(v: number) {
  return v > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : v < 0
      ? 'text-red-500 dark:text-red-400'
      : 'text-zinc-500'
}

function PnlCell({ value, pct }: { value: number; pct?: number }) {
  const cls = pnlClass(value)
  return (
    <span className={`font-mono text-xs ${cls}`}>
      {value >= 0 ? '+' : ''}₹{value.toFixed(2)}
      {pct !== undefined && (
        <span className="ml-1 text-[10px]">({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span>
      )}
    </span>
  )
}

function MetricCard({
  label, value, sub, positive,
}: { label: string; value: string; sub?: string; positive?: boolean }) {
  const valCls = positive === undefined
    ? 'text-zinc-900 dark:text-zinc-50'
    : positive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${valCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

function JournalDrawer({
  tradeId, onClose, token,
}: { tradeId: string; onClose: () => void; token: string }) {
  const [notes, setNotes] = useState('')
  const [rating, setRating] = useState(3)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getJournalEntry(token, tradeId).then(e => {
      if (e) { setNotes(e.notes); setRating(e.rating) }
    })
  }, [token, tradeId])

  async function handleSave() {
    setSaving(true)
    try {
      await saveJournalEntry(token, tradeId, notes, rating, [])
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-6 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Trade Journal</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">×</button>
        </div>
        <div className="mb-3 flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`text-xl ${n <= rating ? 'text-amber-400' : 'text-zinc-300'}`}
            >
              ★
            </button>
          ))}
          <span className="ml-2 self-center text-xs text-zinc-400">{rating}/5</span>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={5}
          placeholder="Why did you take this trade? What did you learn?"
          className="w-full resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PortfolioView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [journalTradeId, setJournalTradeId] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    getPortfolio(t).then(setData).catch(() => {
      localStorage.removeItem('mts_token')
      router.replace('/login')
    }).finally(() => setLoading(false))
  }, [router])

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading portfolio…</p>
      </div>
    )
  }

  const { summary, positions, closed_trades, equity_curve, sector_allocation } = data
  const sectorSlices = Object.entries(sector_allocation ?? {})
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const totalPnlPositive = summary.total_pnl >= 0
  const unrealPositive = summary.unrealized_pnl >= 0
  const realPositive = summary.realized_pnl >= 0

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Portfolio" />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Portfolio</h1>
          <p className="text-xs text-zinc-400">Paper trading P&amp;L · live prices</p>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Total P&L"
            value={`${totalPnlPositive ? '+' : ''}₹${summary.total_pnl.toFixed(0)}`}
            positive={totalPnlPositive}
          />
          <MetricCard
            label="Unrealized"
            value={`${unrealPositive ? '+' : ''}₹${summary.unrealized_pnl.toFixed(0)}`}
            sub={`${summary.open_positions} open`}
            positive={unrealPositive}
          />
          <MetricCard
            label="Realized"
            value={`${realPositive ? '+' : ''}₹${summary.realized_pnl.toFixed(0)}`}
            sub={`${summary.closed_trades} closed`}
            positive={realPositive}
          />
          <MetricCard
            label="Win Rate"
            value={`${summary.win_rate}%`}
            sub={`${summary.winners}W / ${summary.losers}L`}
            positive={summary.win_rate >= 50}
          />
          <MetricCard
            label="Invested"
            value={`₹${summary.total_invested.toFixed(0)}`}
            sub="open positions"
          />
          <MetricCard
            label="Total Trades"
            value={String(summary.total_trades)}
            sub="paper trades"
          />
        </div>

        {/* Equity curve + sector allocation */}
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EquityChart data={equity_curve} />
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-4 text-xs font-medium text-zinc-400 uppercase tracking-wider">Sector Allocation</p>
            <DonutChart data={sectorSlices} />
          </div>
        </div>

        {/* Tab switcher */}
        <div className="mb-4 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
          {(['open', 'closed'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'
              }`}
            >
              {t === 'open' ? `Open Positions (${positions.length})` : `Closed Trades (${closed_trades.length})`}
            </button>
          ))}
        </div>

        {/* Open positions table */}
        {tab === 'open' && (
          positions.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-400">No open positions. Place a paper trade to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                    {['Symbol', 'Side', 'Qty', 'Entry', 'Current', 'Invested', 'Unreal P&L', 'Target', 'Stop', 'Days', 'Conf'].map(h => (
                      <th key={h} className="px-3 py-3 text-xs font-medium text-zinc-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {positions.map((p: PortfolioPosition) => (
                    <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {p.symbol.replace(/\.(NS|BO)$/, '')}
                        </p>
                        <p className="text-[10px] text-zinc-400">{p.exchange}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                          p.signal === 'BUY'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
                            : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
                        }`}>
                          {p.signal}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{p.quantity}</td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">₹{p.entry_price.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-900 dark:text-zinc-50">₹{p.current_price.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-500">₹{p.invested.toFixed(0)}</td>
                      <td className="px-3 py-3">
                        <PnlCell value={p.unrealized_pnl} pct={p.unrealized_pnl_pct} />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-emerald-600 dark:text-emerald-400">₹{p.target.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-red-500 dark:text-red-400">₹{p.stop_loss.toFixed(2)}</td>
                      <td className="px-3 py-3 text-xs text-zinc-500">{p.days_held}d</td>
                      <td className="px-3 py-3 text-xs text-zinc-500">
                        {p.ai_confidence !== null ? `${Math.round(p.ai_confidence * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Closed trades table */}
        {tab === 'closed' && (
          closed_trades.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-400">No closed trades yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                    {['Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Days', 'Closed', 'Journal'].map(h => (
                      <th key={h} className="px-3 py-3 text-xs font-medium text-zinc-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {closed_trades.map((t: PortfolioClosedTrade) => (
                    <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {t.symbol.replace(/\.(NS|BO)$/, '')}
                        </p>
                        <p className="text-[10px] text-zinc-400">{t.exchange}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                          t.signal === 'BUY'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
                            : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
                        }`}>
                          {t.signal}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{t.quantity}</td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">₹{t.entry_price.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {t.exit_price != null ? `₹${t.exit_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <PnlCell value={t.pnl} pct={t.pnl_pct} />
                      </td>
                      <td className="px-3 py-3 text-xs text-zinc-500">{t.days_held}d</td>
                      <td className="px-3 py-3 text-xs text-zinc-500">
                        {t.closed_at ? new Date(t.closed_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => setJournalTradeId(t.id)}
                          className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
                        >
                          Notes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </main>

      {journalTradeId && (
        <JournalDrawer
          tradeId={journalTradeId}
          onClose={() => setJournalTradeId(null)}
          token={tokenRef.current}
        />
      )}
    </div>
  )
}

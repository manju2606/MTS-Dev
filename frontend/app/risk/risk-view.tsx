'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getRiskConfig, getRiskStatus, validateTrade } from '@/lib/api'
import type { RiskCheckResult, RiskConfig, RiskStatus } from '@/lib/api'

const NAV = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

function NavBar() {
  const router = useRouter()
  function signOut() { localStorage.removeItem('mts_token'); router.replace('/login') }
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Manju Trade AI Pro</span>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/dashboard" className={NAV}>Watchlist</Link>
            <Link href="/ai" className={NAV}>AI Analysis</Link>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">Risk</span>
            <Link href="/backtest" className={NAV}>Backtest</Link>
            <Link href="/paper" className={NAV}>Paper Trading</Link>
          </nav>
        </div>
        <button onClick={signOut} className={`text-xs ${NAV}`}>Sign out</button>
      </div>
    </header>
  )
}

function StatCard({ label, value, sub, color = '' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color || 'text-zinc-900 dark:text-zinc-50'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

export default function RiskView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [status, setStatus] = useState<RiskStatus | null>(null)
  const [config, setConfig] = useState<RiskConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // validator form
  const [signal, setSignal] = useState<'BUY' | 'SELL'>('BUY')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [qty, setQty] = useState('')
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<RiskCheckResult | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    Promise.all([getRiskStatus(t), getRiskConfig(t)])
      .then(([s, c]) => { setStatus(s); setConfig(c) })
      .catch(() => { router.replace('/login') })
      .finally(() => setLoading(false))
  }, [router])

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault()
    setValidating(true)
    setResult(null)
    try {
      const r = await validateTrade(tokenRef.current, {
        signal,
        entry_price: parseFloat(entry),
        stop_loss: parseFloat(stop),
        target: parseFloat(target),
        quantity: parseInt(qty, 10),
      })
      setResult(r)
    } finally {
      setValidating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    )
  }

  const pnlColor = (status?.daily_pnl ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Risk Engine</h1>
          <p className="text-xs text-zinc-400">All trades must pass risk checks before execution</p>
        </div>

        {/* Status row */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Open Positions" value={String(status?.open_trades ?? 0)} />
          <StatCard
            label="Daily P&L"
            value={`₹${(status?.daily_pnl ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            color={pnlColor}
          />
          <StatCard
            label="Circuit Breaker"
            value={status?.circuit_breaker_active ? 'ACTIVE' : 'Inactive'}
            sub={status?.circuit_breaker_active ? 'Trading halted' : 'Within daily loss limits'}
            color={status?.circuit_breaker_active ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
          />
        </div>

        {/* Risk config */}
        {config && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Risk Configuration</h2>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              {[
                ['Capital', `₹${config.capital.toLocaleString('en-IN')}`],
                ['Max Position', `${(config.max_position_pct * 100).toFixed(0)}% of capital`],
                ['Daily Loss Limit', `${(config.max_daily_loss_pct * 100).toFixed(0)}%`],
                ['Max Drawdown', `${(config.max_drawdown_pct * 100).toFixed(0)}% (circuit breaker)`],
                ['Min R:R Ratio', `${config.min_risk_reward}:1`],
                ['Max Stop Distance', `${(config.max_stop_pct * 100).toFixed(0)}% of entry`],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-zinc-400">{k}</p>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade validator */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Trade Validator</h2>
          <form onSubmit={handleValidate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500">Signal</label>
              <select
                value={signal}
                onChange={e => setSignal(e.target.value as 'BUY' | 'SELL')}
                className={INPUT}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            {[
              ['Entry ₹', entry, setEntry, 'e.g. 2450'],
              ['Stop Loss ₹', stop, setStop, 'e.g. 2380'],
              ['Target ₹', target, setTarget, 'e.g. 2600'],
              ['Quantity', qty, setQty, 'e.g. 10'],
            ].map(([label, val, setter, ph]) => (
              <div key={label as string} className="flex flex-col gap-1">
                <label className="text-xs text-zinc-500">{label as string}</label>
                <input
                  type="number"
                  value={val as string}
                  onChange={e => (setter as (v: string) => void)(e.target.value)}
                  placeholder={ph as string}
                  required
                  min={0}
                  className={`w-32 ${INPUT}`}
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={validating}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {validating ? 'Checking…' : 'Validate'}
            </button>
          </form>

          {result && (
            <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${
              result.passed
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300'
            }`}>
              {result.passed ? (
                <p>✓ Risk check passed — max quantity: <strong>{result.max_quantity}</strong></p>
              ) : (
                <ul className="space-y-1">
                  {result.violations.map((v, i) => <li key={i}>✗ {v}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

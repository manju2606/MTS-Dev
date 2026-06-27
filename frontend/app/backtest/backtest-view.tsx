'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { runBacktest } from '@/lib/api'
import type { BacktestResult } from '@/lib/api'

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
            <Link href="/risk" className={NAV}>Risk</Link>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">Backtest</span>
            <Link href="/paper" className={NAV}>Paper Trading</Link>
          </nav>
        </div>
        <button onClick={signOut} className={`text-xs ${NAV}`}>Sign out</button>
      </div>
    </header>
  )
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive === undefined
    ? 'text-zinc-900 dark:text-zinc-50'
    : positive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export default function BacktestView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [symbol, setSymbol] = useState('RELIANCE')
  const [period, setPeriod] = useState('6mo')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
  }, [router])

  async function handleRun(e: React.FormEvent) {
    e.preventDefault()
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await runBacktest(tokenRef.current, symbol.trim(), period)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Backtesting</h1>
          <p className="text-xs text-zinc-400">SMA 20/50 crossover strategy on historical NSE/BSE data</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <form onSubmit={handleRun} className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500">Symbol</label>
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                placeholder="e.g. RELIANCE"
                className={`w-44 ${INPUT}`}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500">Period</label>
              <select value={period} onChange={e => setPeriod(e.target.value)} className={INPUT}>
                <option value="3mo">3 months</option>
                <option value="6mo">6 months</option>
                <option value="1y">1 year</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={running}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? 'Running…' : 'Run Backtest'}
            </button>
          </form>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                {result.symbol} · {result.strategy} · {result.start_date} → {result.end_date}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetricCard
                  label="Total Return"
                  value={`${result.total_return_pct > 0 ? '+' : ''}${result.total_return_pct.toFixed(2)}%`}
                  positive={result.total_return_pct >= 0}
                />
                <MetricCard
                  label="Max Drawdown"
                  value={`-${result.max_drawdown_pct.toFixed(2)}%`}
                  positive={result.max_drawdown_pct < 10}
                />
                <MetricCard
                  label="Win Rate"
                  value={`${result.win_rate_pct.toFixed(1)}%`}
                  positive={result.win_rate_pct >= 50}
                />
                <MetricCard
                  label="Total Trades"
                  value={String(result.total_trades)}
                />
                <MetricCard
                  label="Sharpe Ratio"
                  value={result.sharpe_ratio.toFixed(2)}
                  positive={result.sharpe_ratio >= 1}
                />
              </div>
            </div>

            {/* Equity summary */}
            {result.equity_curve.length > 0 && (
              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Equity Curve</h2>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">
                    Start: <span className="font-mono font-medium text-zinc-900 dark:text-zinc-50">
                      ₹{result.equity_curve[0].value.toLocaleString('en-IN')}
                    </span>
                  </span>
                  <span className="text-zinc-500">
                    End: <span className={`font-mono font-medium ${result.total_return_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                      ₹{result.equity_curve[result.equity_curve.length - 1].value.toLocaleString('en-IN')}
                    </span>
                  </span>
                </div>
                {/* Simple bar representation */}
                <div className="mt-3 flex h-12 items-end gap-0.5 overflow-hidden">
                  {result.equity_curve.map((pt, i) => {
                    const vals = result.equity_curve.map(p => p.value)
                    const minV = Math.min(...vals)
                    const maxV = Math.max(...vals)
                    const range = maxV - minV || 1
                    const h = Math.max(4, ((pt.value - minV) / range) * 100)
                    const color = pt.value >= result.equity_curve[0].value ? 'bg-emerald-400' : 'bg-red-400'
                    return <div key={i} className={`flex-1 rounded-sm ${color}`} style={{ height: `${h}%` }} />
                  })}
                </div>
              </div>
            )}

            {/* Trade table */}
            {result.trades.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Entry Date', 'Exit Date', 'Entry ₹', 'Exit ₹', 'P&L ₹', 'P&L %'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-zinc-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {result.trades.map((t, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{t.date_in}</td>
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{t.date_out}</td>
                        <td className="px-4 py-2 font-mono text-zinc-900 dark:text-zinc-50">₹{t.entry.toFixed(2)}</td>
                        <td className="px-4 py-2 font-mono text-zinc-900 dark:text-zinc-50">₹{t.exit.toFixed(2)}</td>
                        <td className={`px-4 py-2 font-mono font-semibold ${t.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                          {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2 font-mono font-semibold ${t.pnl_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                          {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

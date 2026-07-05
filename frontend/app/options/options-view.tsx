'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getOptionsExpiries, getOptionsChain } from '@/lib/api'
import type { OptionsChain, OptionsRow } from '@/lib/api'

function pct(v: number) {
  const cls = v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-400'
  return <span className={`${cls} font-mono text-xs`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>
}

function OIBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500">{value > 0 ? (value / 1000).toFixed(0) + 'K' : '—'}</span>
    </div>
  )
}

function ChainTable({ rows, type, maxOI, spot }: {
  rows: OptionsRow[]; type: 'call' | 'put'; maxOI: number; spot: number | null
}) {
  const sorted = [...rows].sort((a, b) => type === 'call' ? a.strike - b.strike : b.strike - a.strike)
  const thCls = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400'
  const tdCls = 'px-3 py-2 text-xs'

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {type === 'call'
              ? ['LTP', 'Bid', 'Ask', 'OI', 'Vol', 'IV%', 'Chg%', 'Strike'].map(h => <th key={h} className={thCls}>{h}</th>)
              : ['Strike', 'LTP', 'Bid', 'Ask', 'OI', 'Vol', 'IV%', 'Chg%'].map(h => <th key={h} className={thCls}>{h}</th>)
            }
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const isATM = spot !== null && Math.abs(r.strike - spot) < 25
            const rowCls = `border-b border-zinc-50 dark:border-zinc-800/50 ${
              isATM ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : r.in_the_money ? 'bg-zinc-50/50 dark:bg-zinc-800/20' : ''
            }`
            if (type === 'call') return (
              <tr key={r.strike} className={rowCls}>
                <td className={`${tdCls} font-mono font-semibold text-zinc-800 dark:text-zinc-200`}>₹{r.last_price.toFixed(2)}</td>
                <td className={`${tdCls} font-mono text-zinc-600 dark:text-zinc-400`}>{r.bid ? `₹${r.bid.toFixed(2)}` : '—'}</td>
                <td className={`${tdCls} font-mono text-zinc-600 dark:text-zinc-400`}>{r.ask ? `₹${r.ask.toFixed(2)}` : '—'}</td>
                <td className={tdCls}><OIBar value={r.open_interest} max={maxOI} /></td>
                <td className={`${tdCls} text-zinc-500`}>{r.volume > 0 ? (r.volume / 1000).toFixed(0) + 'K' : '—'}</td>
                <td className={`${tdCls} font-mono text-zinc-500`}>{r.iv !== null ? r.iv.toFixed(1) + '%' : '—'}</td>
                <td className={tdCls}>{pct(r.change_pct)}</td>
                <td className={`${tdCls} font-bold text-zinc-900 dark:text-zinc-50 ${isATM ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {r.strike}
                  {isATM && <span className="ml-1 rounded bg-indigo-100 px-1 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300">ATM</span>}
                </td>
              </tr>
            )
            return (
              <tr key={r.strike} className={rowCls}>
                <td className={`${tdCls} font-bold text-zinc-900 dark:text-zinc-50 ${isATM ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {r.strike}
                  {isATM && <span className="ml-1 rounded bg-indigo-100 px-1 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300">ATM</span>}
                </td>
                <td className={`${tdCls} font-mono font-semibold text-zinc-800 dark:text-zinc-200`}>₹{r.last_price.toFixed(2)}</td>
                <td className={`${tdCls} font-mono text-zinc-600 dark:text-zinc-400`}>{r.bid ? `₹${r.bid.toFixed(2)}` : '—'}</td>
                <td className={`${tdCls} font-mono text-zinc-600 dark:text-zinc-400`}>{r.ask ? `₹${r.ask.toFixed(2)}` : '—'}</td>
                <td className={tdCls}><OIBar value={r.open_interest} max={maxOI} /></td>
                <td className={`${tdCls} text-zinc-500`}>{r.volume > 0 ? (r.volume / 1000).toFixed(0) + 'K' : '—'}</td>
                <td className={`${tdCls} font-mono text-zinc-500`}>{r.iv !== null ? r.iv.toFixed(1) + '%' : '—'}</td>
                <td className={tdCls}>{pct(r.change_pct)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function OptionsView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [symbol, setSymbol] = useState('NIFTY')
  const [inputSymbol, setInputSymbol] = useState('NIFTY')
  const [expiries, setExpiries] = useState<string[]>([])
  const [expiry, setExpiry] = useState('')
  const [chain, setChain] = useState<OptionsChain | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const loadExpiries = useCallback(async (t: string, sym: string) => {
    setErr(null); setChain(null); setExpiries([])
    try {
      const list = await getOptionsExpiries(t, sym)
      setExpiries(list)
      if (list.length) setExpiry(list[0])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load expiries')
    }
  }, [])

  const loadChain = useCallback(async (t: string, sym: string, exp: string) => {
    if (!exp) return
    setLoading(true); setErr(null)
    try {
      const data = await getOptionsChain(t, sym, exp)
      setChain(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load chain')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    loadExpiries(t, symbol)
  }, [router, loadExpiries, symbol])

  useEffect(() => {
    if (expiry) loadChain(tokenRef.current, symbol, expiry)
  }, [expiry, symbol, loadChain])

  function search() {
    const s = inputSymbol.trim().toUpperCase()
    if (s) { setSymbol(s); loadExpiries(tokenRef.current, s) }
  }

  if (!authChecked) return null

  const maxCallOI = chain ? Math.max(...chain.calls.map(r => r.open_interest), 1) : 1
  const maxPutOI  = chain ? Math.max(...chain.puts.map(r => r.open_interest), 1) : 1

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Options Chain" />
      <main className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Options Chain</h1>
            <p className="text-xs text-zinc-400">NSE/BSE calls & puts — live data via yfinance</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <input
              value={inputSymbol}
              onChange={e => setInputSymbol(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Symbol (e.g. NIFTY, RELIANCE)"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 w-52"
            />
            <button onClick={search} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
              Load
            </button>
            {expiries.length > 0 && (
              <select
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {expiries.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            )}
          </div>
        </div>

        {err && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}

        {/* Summary bar */}
        {chain && (
          <div className="mb-5 flex flex-wrap gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            {[
              { label: 'Spot', value: chain.spot ? `₹${chain.spot.toLocaleString('en-IN')}` : '—' },
              { label: 'ATM Strike', value: chain.atm_strike ?? '—' },
              { label: 'PCR (OI)', value: chain.pcr ? chain.pcr.toFixed(3) : '—', color: chain.pcr ? (chain.pcr > 1.2 ? 'text-emerald-600' : chain.pcr < 0.8 ? 'text-red-500' : '') : '' },
              { label: 'Max Pain', value: chain.max_pain ?? '—' },
              { label: 'Total Call OI', value: (chain.total_call_oi / 1000).toFixed(0) + 'K' },
              { label: 'Total Put OI', value: (chain.total_put_oi / 1000).toFixed(0) + 'K' },
            ].map(({ label, value, color = '' }) => (
              <div key={label}>
                <p className="text-[10px] text-zinc-400">{label}</p>
                <p className={`text-sm font-bold ${color || 'text-zinc-900 dark:text-zinc-50'}`}>{String(value)}</p>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {/* Chain tables side-by-side */}
        {chain && !loading && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                Calls ({chain.calls.length})
              </p>
              <ChainTable rows={chain.calls} type="call" maxOI={maxCallOI} spot={chain.spot} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide">
                Puts ({chain.puts.length})
              </p>
              <ChainTable rows={chain.puts} type="put" maxOI={maxPutOI} spot={chain.spot} />
            </div>
          </div>
        )}

        {!chain && !loading && !err && expiries.length === 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-20 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">Enter a symbol and click Load to view the options chain.</p>
            <p className="mt-1 text-xs text-zinc-400">Try: NIFTY, BANKNIFTY, RELIANCE, TCS, INFY</p>
          </div>
        )}
      </main>
    </div>
  )
}

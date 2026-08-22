'use client'

import { useEffect, useState } from 'react'
import { getPineAlerts } from '@/lib/api'
import type { PineAlert } from '@/lib/api'

const POLL_MS = 30_000

const TYPE_STYLE: Record<PineAlert['signal_type'], string> = {
  'STRONG BUY': 'bg-emerald-600 text-white',
  BUY: 'bg-emerald-500/90 text-white',
  'STRONG SELL': 'bg-red-600 text-white',
  SELL: 'bg-red-500/90 text-white',
  HOLD: 'bg-zinc-400 text-white',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

function fmtPrice(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// Live feed of what the actual Pine Script running on TradingView fired
// (via the webhook receiver at /mcx/pine-alerts/webhook), separate from and
// alongside this app's own independently computed strategy signal above --
// the two engines can disagree, which is exactly why this exists.
export function PineAlertsCard({ contract }: { contract: string }) {
  const [alerts, setAlerts] = useState<PineAlert[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    function load() {
      getPineAlerts(t, contract)
        .then(r => { setAlerts(r); setErr(null) })
        .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load Pine Alerts'))
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [contract])

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">📟 Pine Alerts</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            What the actual Pine Script fired on TradingView&apos;s own servers — a second, independent record
            alongside this page&apos;s own live score above.
          </p>
        </div>
        {alerts && (
          <span className="text-[11px] text-zinc-400">{alerts.length} recent</span>
        )}
      </div>

      {err && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {err}
        </p>
      )}

      {alerts === null && !err ? (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : alerts && alerts.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
          No Pine Alerts received yet — TradingView will POST here the moment the Pine Script&apos;s own
          BUY/STRONG BUY/SELL/STRONG SELL condition fires.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-2 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Date / Time (IST)</th>
                <th className="px-2 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Type</th>
                <th className="px-2 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Strategy</th>
                <th className="px-2 py-1.5 text-right font-semibold text-zinc-500 dark:text-zinc-400">Price</th>
                <th className="px-2 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Message</th>
              </tr>
            </thead>
            <tbody>
              {alerts?.map((a, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-zinc-600 dark:text-zinc-300">
                    {fmtDateTime(a.tv_time ?? a.received_at)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${TYPE_STYLE[a.signal_type] ?? 'bg-zinc-400 text-white'}`}>
                      {a.signal_type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-zinc-600 dark:text-zinc-300">{a.strategy}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{fmtPrice(a.price)}</td>
                  <td className="px-2 py-2 text-zinc-500 dark:text-zinc-400">{a.message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

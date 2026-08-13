'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import {
  compareChartinkBatches, createChartinkScanLink, deleteChartinkScanLink, getMe,
  listChartinkScanLinks, pollChartinkScanLinkNow, updateChartinkScanLink,
} from '@/lib/api'
import type {
  ChartinkCandidate, ChartinkCompareResult, ChartinkScanLink, User,
} from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeAgo(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

// ── Add scan link form ───────────────────────────────────────────────────────

function AddScanLinkForm({ token, onCreated }: { token: string; onCreated: (l: ChartinkScanLink) => void }) {
  const [scanName, setScanName] = useState('')
  const [url, setUrl] = useState('')
  const [interval, setIntervalMin] = useState('60')
  const [scanClause, setScanClause] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showClauseHelp, setShowClauseHelp] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!scanName.trim() || !url.trim()) { setErr('Scan name and URL are required'); return }
    setBusy(true)
    setErr(null)
    try {
      const link = await createChartinkScanLink(token, {
        scan_name: scanName.trim(),
        url: url.trim(),
        poll_interval_minutes: parseInt(interval, 10) || 60,
        scan_clause: scanClause.trim() || undefined,
      })
      onCreated(link)
      setScanName(''); setUrl(''); setIntervalMin('60'); setScanClause('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create scan link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Add Scan Link</h2>
      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Scan name</label>
          <input value={scanName} onChange={e => setScanName(e.target.value)} placeholder="e.g. Breakout Watch" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Chartink screener URL</label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://chartink.com/screener/your-scan" className={inputCls} />
        </div>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Poll every (minutes)</label>
          <input type="number" min={5} max={1440} value={interval} onChange={e => setIntervalMin(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between">
            <label className="mb-1 block text-[10px] font-medium text-zinc-400">Scan clause (optional override)</label>
            <button type="button" onClick={() => setShowClauseHelp(v => !v)} className="text-[10px] text-indigo-500 hover:text-indigo-700">
              {showClauseHelp ? 'hide' : 'what is this?'}
            </button>
          </div>
          <input value={scanClause} onChange={e => setScanClause(e.target.value)} placeholder="leave blank to auto-detect" className={inputCls} />
        </div>
      </div>
      {showClauseHelp && (
        <p className="mb-3 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          Chartink&apos;s screener page auto-detection is best-effort and can fail. If polling reports an error about the
          scan condition, open your scan on chartink.com, open DevTools → Network, click &quot;Run Scan&quot;, find the POST
          request to <code>screener/process</code>, and paste its <code>scan_clause</code> field value here.
        </p>
      )}
      <button type="submit" disabled={busy}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
        {busy ? 'Adding…' : 'Add Scan Link'}
      </button>
    </form>
  )
}

// ── Scan links table ─────────────────────────────────────────────────────────

function ScanLinksTable({
  links, token, isAdmin, onChanged,
}: {
  links: ChartinkScanLink[]
  token: string
  isAdmin: boolean
  onChanged: (l: ChartinkScanLink) => void
}) {
  const [pollingId, setPollingId] = useState<string | null>(null)
  const [pollMsg, setPollMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  async function pollNow(link: ChartinkScanLink) {
    setPollingId(link.id)
    setPollMsg(null)
    try {
      const result = await pollChartinkScanLinkNow(token, link.id)
      setPollMsg({
        id: link.id, ok: result.ok,
        text: result.ok ? `Scored ${result.scored} candidate(s)` : (result.error ?? 'Poll failed'),
      })
      const refreshed = await listChartinkScanLinks(token)
      const updated = refreshed.find(l => l.id === link.id)
      if (updated) onChanged(updated)
    } catch (e) {
      setPollMsg({ id: link.id, ok: false, text: e instanceof Error ? e.message : 'Poll failed' })
    } finally {
      setPollingId(null)
    }
  }

  async function toggleEnabled(link: ChartinkScanLink) {
    const updated = await updateChartinkScanLink(token, link.id, { enabled: !link.enabled })
    onChanged(updated)
  }

  async function remove(link: ChartinkScanLink) {
    await deleteChartinkScanLink(token, link.id)
    onChanged({ ...link, enabled: false, last_poll_status: '__deleted__' })
  }

  if (!links.length) return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-2xl">🕐</p>
      <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">No scan links yet</p>
      <p className="mt-1 text-xs text-zinc-400">Add one above to start polling a Chartink scan on a schedule</p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
            {['Scan', 'Interval', 'Last Polled', 'Status', 'Count', ''].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {links.map(link => (
            <tr key={link.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
              <td className="px-3 py-2">
                <p className="font-bold text-zinc-800 dark:text-zinc-200">{link.scan_name}</p>
                <p className="max-w-[220px] truncate text-[10px] text-zinc-400" title={link.url}>{link.url}</p>
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">every {link.poll_interval_minutes}m</td>
              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{timeAgo(link.last_polled_at)}</td>
              <td className="px-3 py-2">
                {link.last_poll_status ? (
                  <span className={link.last_poll_status.startsWith('error') ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                    {link.last_poll_status}
                  </span>
                ) : <span className="text-zinc-400">—</span>}
                {pollMsg?.id === link.id && (
                  <p className={`mt-0.5 text-[10px] ${pollMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{pollMsg.text}</p>
                )}
              </td>
              <td className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-300">{link.last_poll_count}</td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-2">
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => pollNow(link)}
                        disabled={pollingId === link.id}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                      >
                        {pollingId === link.id ? 'Polling…' : '▶ Run Now'}
                      </button>
                      <button
                        onClick={() => toggleEnabled(link)}
                        className={`text-[10px] font-semibold ${link.enabled ? 'text-amber-600 hover:text-amber-800 dark:text-amber-400' : 'text-emerald-600 hover:text-emerald-800 dark:text-emerald-400'}`}
                      >
                        {link.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => remove(link)} className="text-[10px] text-red-400 hover:text-red-600">Delete</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Comparison view (Part 4 visualization) ──────────────────────────────────

function CandidateChip({ c }: { c: ChartinkCandidate }) {
  const sym = c.symbol.replace(/\.(NS|BO)$/, '')
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-100 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{sym}</p>
        <p className="text-[10px] text-zinc-400">RSI {c.rsi.toFixed(0)} · conf {Math.round(c.confidence * 100)}%</p>
      </div>
      <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">₹{fmt(c.entry_price)}</p>
    </div>
  )
}

function ComparisonColumn({
  title, subtitle, candidates, colorClass,
}: {
  title: string
  subtitle: string
  candidates: ChartinkCandidate[]
  colorClass: string
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/30">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className={`text-xs font-bold uppercase tracking-wide ${colorClass}`}>{title}</p>
          <p className="text-[10px] text-zinc-400">{subtitle}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${colorClass} bg-white dark:bg-zinc-900`}>{candidates.length}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-zinc-400">none</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {candidates.map(c => <CandidateChip key={c.id} c={c} />)}
        </div>
      )}
    </div>
  )
}

function ComparisonSection({ token, scanNames }: { token: string; scanNames: string[] }) {
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<ChartinkCompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selected && scanNames.length > 0) setSelected(scanNames[0])
  }, [scanNames, selected])

  const runCompare = useCallback(async (scanName: string) => {
    if (!scanName) return
    setLoading(true)
    setError(null)
    try {
      const r = await compareChartinkBatches(token, scanName)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compare')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (selected) runCompare(selected)
  }, [selected, runCompare])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Run-over-run Comparison</h2>
          <p className="text-[11px] text-zinc-400">New / persistent / dropped stocks between this scan&apos;s two most recent batches (webhook or poll — either source)</p>
        </div>
        <div className="flex items-center gap-2">
          {scanNames.length > 0 ? (
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {scanNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <input
              placeholder="scan name"
              value={selected}
              onChange={e => setSelected(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runCompare(selected)}
              className={inputCls}
            />
          )}
          <button
            onClick={() => runCompare(selected)}
            disabled={loading || !selected}
            className="rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-600 disabled:opacity-60 dark:bg-zinc-600 dark:hover:bg-zinc-500"
          >
            {loading ? 'Comparing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {!result ? (
        <p className="py-6 text-center text-xs text-zinc-400">{loading ? 'Loading…' : 'Pick a scan to compare its two most recent batches.'}</p>
      ) : !result.latest_received_at ? (
        <p className="py-6 text-center text-xs text-zinc-400">No batches yet for &quot;{result.scan_name}&quot; — candidates appear here once a webhook alert or scan-link poll lands.</p>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-zinc-400">
            Latest batch: {timeAgo(result.latest_received_at)}
            {result.previous_received_at && <> · Previous: {timeAgo(result.previous_received_at)}</>}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <ComparisonColumn
              title="New" subtitle="in latest, not previous"
              candidates={result.new} colorClass="text-emerald-600 dark:text-emerald-400"
            />
            <ComparisonColumn
              title="Persistent" subtitle="in both — repeating"
              candidates={result.persistent} colorClass="text-indigo-600 dark:text-indigo-400"
            />
            <ComparisonColumn
              title="Dropped" subtitle="in previous, not latest"
              candidates={result.dropped} colorClass="text-zinc-500 dark:text-zinc-400"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChartinkScannerView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [user, setUser] = useState<User | null>(null)
  const [links, setLinks] = useState<ChartinkScanLink[]>([])
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    getMe(t).then(setUser).catch(() => {})
    listChartinkScanLinks(t).then(setLinks).catch(() => {}).finally(() => setLoading(false))
  }, [router])

  function handleChanged(updated: ChartinkScanLink) {
    if (updated.last_poll_status === '__deleted__') {
      setLinks(prev => prev.filter(l => l.id !== updated.id))
      return
    }
    setLinks(prev => prev.map(l => l.id === updated.id ? updated : l))
  }

  const isAdmin = user?.role === 'admin'
  const scanNames = Array.from(new Set(links.map(l => l.scan_name))).sort()

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Chartink Scanner" />
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Chartink Scanner</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Poll a saved Chartink scan link on a schedule — the pull-based alternative to the webhook.
            Results score and store exactly like a webhook alert (same <a href="/chartink" className="text-indigo-500 hover:underline">Chartink</a> table),
            plus a run-over-run comparison of what&apos;s new, repeating, or dropped.
          </p>
        </div>

        {isAdmin && (
          <AddScanLinkForm token={tokenRef.current} onCreated={l => setLinks(prev => [l, ...prev])} />
        )}

        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        ) : (
          <ScanLinksTable links={links} token={tokenRef.current} isAdmin={isAdmin} onChanged={handleChanged} />
        )}

        <ComparisonSection token={tokenRef.current} scanNames={scanNames} />
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { NavBar } from '@/components/nav-bar'
import {
  compareChartinkBatches, createChartinkScanLink, deleteChartinkScanLink, getChartinkBreakouts, getMe,
  listChartinkScanLinkRuns, listChartinkScanLinks, pollChartinkScanLinkNow, updateChartinkScanLink,
} from '@/lib/api'
import type {
  ChartinkBreakoutRow, ChartinkCandidate, ChartinkCompareResult, ChartinkPollRun, ChartinkScanLink, User,
} from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
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

// ── Edit scan link form ──────────────────────────────────────────────────────

function EditScanLinkForm({
  link, token, onSaved, onCancel,
}: {
  link: ChartinkScanLink
  token: string
  onSaved: (l: ChartinkScanLink) => void
  onCancel: () => void
}) {
  const [scanName, setScanName] = useState(link.scan_name)
  const [url, setUrl] = useState(link.url)
  const [interval, setIntervalMin] = useState(String(link.poll_interval_minutes))
  const [scanClause, setScanClause] = useState(link.scan_clause ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!scanName.trim() || !url.trim()) { setErr('Scan name and URL are required'); return }
    setBusy(true)
    setErr(null)
    try {
      const updated = await updateChartinkScanLink(token, link.id, {
        scan_name: scanName.trim(),
        url: url.trim(),
        poll_interval_minutes: parseInt(interval, 10) || link.poll_interval_minutes,
        scan_clause: scanClause.trim() || undefined,
      })
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Scan name</label>
          <input value={scanName} onChange={e => setScanName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Chartink screener URL</label>
          <input value={url} onChange={e => setUrl(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Poll every (minutes)</label>
          <input type="number" min={5} max={1440} value={interval} onChange={e => setIntervalMin(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium text-zinc-400">
          Scan clause — paste the value from your browser&apos;s Network tab (screener/process request payload)
        </label>
        <textarea
          value={scanClause}
          onChange={e => setScanClause(e.target.value)}
          rows={3}
          placeholder="( {cash} ( daily rsi(14) > 55 ... ) )"
          className={`${inputCls} font-mono`}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
      </div>
    </div>
  )
}

// ── Run history panel ────────────────────────────────────────────────────────

function RunHistoryPanel({ linkId, token }: { linkId: string; token: string }) {
  const [runs, setRuns] = useState<ChartinkPollRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listChartinkScanLinkRuns(token, linkId)
      .then(setRuns)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load run history'))
  }, [linkId, token])

  if (error) return <p className="text-xs text-red-500">{error}</p>
  if (runs === null) return <p className="text-xs text-zinc-400">Loading…</p>
  if (runs.length === 0) return <p className="text-xs text-zinc-400">No runs recorded yet.</p>

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
            {['When', 'Status', 'Count'].map(h => (
              <th key={h} className="px-2.5 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="px-2.5 py-1.5 text-zinc-500 dark:text-zinc-400">{timeAgo(r.polled_at)}</td>
              <td className={`px-2.5 py-1.5 ${r.status.startsWith('error') ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {r.status}
              </td>
              <td className="px-2.5 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)

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
            <React.Fragment key={link.id}>
            <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
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
                  <button
                    onClick={() => setHistoryId(id => id === link.id ? null : link.id)}
                    className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    {historyId === link.id ? 'Close' : 'History'}
                  </button>
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
                        onClick={() => setEditingId(id => id === link.id ? null : link.id)}
                        className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      >
                        {editingId === link.id ? 'Close' : 'Edit'}
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
            {historyId === link.id && (
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40">
                <td colSpan={6} className="px-3 py-3">
                  <RunHistoryPanel linkId={link.id} token={token} />
                </td>
              </tr>
            )}
            {editingId === link.id && (
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40">
                <td colSpan={6} className="px-3 py-3">
                  <EditScanLinkForm
                    link={link}
                    token={token}
                    onSaved={updated => { onChanged(updated); setEditingId(null) }}
                    onCancel={() => setEditingId(null)}
                  />
                </td>
              </tr>
            )}
            </React.Fragment>
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

// ── Breakout watchlist (Part 5 alerts: 3-in-a-row) ──────────────────────────

function pctCls(v: number | null) {
  if (v === null) return 'text-zinc-400'
  return v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
}

function fmtPct(v: number | null) {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

const BREAKOUT_STATUS_STYLE: Record<ChartinkBreakoutRow['status'], string> = {
  OPEN: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  WIN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  LOSS: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  EXPIRED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

function BreakoutStatusBadge({ status }: { status: ChartinkBreakoutRow['status'] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BREAKOUT_STATUS_STYLE[status]}`}>
      {status}
    </span>
  )
}

type BreakoutSortKey =
  | 'symbol' | 'scan_name' | 'appeared_date' | 'confidence' | 'entry_price' | 'target'
  | 'stop_loss' | 'ltp' | 'change' | 'day_pnl_pct' | 'week_pnl_pct' | 'month_pnl_pct' | 'status'

const BREAKOUT_SORT_COLUMNS: { key: BreakoutSortKey; label: string }[] = [
  { key: 'symbol', label: 'Stock' },
  { key: 'scan_name', label: 'Scan' },
  { key: 'appeared_date', label: 'Appeared' },
  { key: 'confidence', label: 'AI Score' },
  { key: 'entry_price', label: 'Entry' },
  { key: 'target', label: 'Target' },
  { key: 'stop_loss', label: 'SL' },
  { key: 'ltp', label: 'LTP' },
  { key: 'change', label: 'Change' },
  { key: 'day_pnl_pct', label: 'Day %' },
  { key: 'week_pnl_pct', label: 'Week %' },
  { key: 'month_pnl_pct', label: 'Month %' },
  { key: 'status', label: 'Status' },
]

function sortBreakoutRows(rows: ChartinkBreakoutRow[], key: BreakoutSortKey, dir: 'asc' | 'desc') {
  const sorted = [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return String(av).localeCompare(String(bv))
  })
  if (dir === 'desc') sorted.reverse()
  return sorted
}

const QUALITY_GATE_DEFAULTS = { minConfidence: '', minRR: '', minAdx: '', minVolumeRatio: '', maxRsi: '' }

function applyQualityGates(rows: ChartinkBreakoutRow[], gates: typeof QUALITY_GATE_DEFAULTS) {
  const minConfidence = gates.minConfidence === '' ? null : Number(gates.minConfidence) / 100
  const minRR = gates.minRR === '' ? null : Number(gates.minRR)
  const minAdx = gates.minAdx === '' ? null : Number(gates.minAdx)
  const minVolumeRatio = gates.minVolumeRatio === '' ? null : Number(gates.minVolumeRatio)
  const maxRsi = gates.maxRsi === '' ? null : Number(gates.maxRsi)

  return rows.filter(r => {
    if (minConfidence !== null && (r.confidence === null || r.confidence < minConfidence)) return false
    if (minRR !== null && (r.risk_reward_ratio === null || r.risk_reward_ratio < minRR)) return false
    if (minAdx !== null && (r.adx === null || r.adx < minAdx)) return false
    if (minVolumeRatio !== null && (r.volume_ratio === null || r.volume_ratio < minVolumeRatio)) return false
    if (maxRsi !== null && (r.rsi === null || r.rsi > maxRsi)) return false
    return true
  })
}

function BreakoutWatchlist({ token }: { token: string }) {
  const [rows, setRows] = useState<ChartinkBreakoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<BreakoutSortKey>('appeared_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [gates, setGates] = useState(QUALITY_GATE_DEFAULTS)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await getChartinkBreakouts(token))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load breakout watchlist')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function toggleSort(key: BreakoutSortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const gatesActive = Object.values(gates).some(v => v !== '')
  const filteredRows = applyQualityGates(rows, gates)
  const sortedRows = sortBreakoutRows(filteredRows, sortKey, sortDir)

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">🚨 Breakout Watchlist</h2>
          <p className="text-[11px] text-zinc-400">
            Stocks that appeared in a scan 3 times in a row — an email goes out the moment each streak crosses 3.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as BreakoutSortKey)}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {BREAKOUT_SORT_COLUMNS.map(({ key, label }) => (
              <option key={key} value={key}>Sort: {label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {sortDir === 'asc' ? '▲ Asc' : '▼ Desc'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-600 disabled:opacity-60 dark:bg-zinc-600 dark:hover:bg-zinc-500"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min AI Score %</label>
          <input
            type="number" min={0} max={100} placeholder="off" value={gates.minConfidence}
            onChange={e => setGates(g => ({ ...g, minConfidence: e.target.value }))}
            className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min R:R</label>
          <input
            type="number" min={0} step={0.1} placeholder="off" value={gates.minRR}
            onChange={e => setGates(g => ({ ...g, minRR: e.target.value }))}
            className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min ADX</label>
          <input
            type="number" min={0} max={100} placeholder="off" value={gates.minAdx}
            onChange={e => setGates(g => ({ ...g, minAdx: e.target.value }))}
            className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Min Volume Ratio</label>
          <input
            type="number" min={0} step={0.1} placeholder="off" value={gates.minVolumeRatio}
            onChange={e => setGates(g => ({ ...g, minVolumeRatio: e.target.value }))}
            className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium text-zinc-400">Max RSI</label>
          <input
            type="number" min={0} max={100} placeholder="off" value={gates.maxRsi}
            onChange={e => setGates(g => ({ ...g, maxRsi: e.target.value }))}
            className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        {gatesActive && (
          <button
            onClick={() => setGates(QUALITY_GATE_DEFAULTS)}
            className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ✕ Clear gates
          </button>
        )}
        {gatesActive && (
          <span className="text-[10px] text-zinc-400">{filteredRows.length} of {rows.length} pass</span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {!loading && rows.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
          <p className="text-2xl">🎯</p>
          <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">No breakouts yet</p>
          <p className="mt-1 text-xs text-zinc-400">A stock lands here once it appears in the same scan 3 times in a row.</p>
        </div>
      ) : !loading && filteredRows.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
          <p className="text-2xl">🔬</p>
          <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">No breakouts pass these quality gates</p>
          <p className="mt-1 text-xs text-zinc-400">{rows.length} breakout{rows.length === 1 ? '' : 's'} loaded, none met the current thresholds.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                {BREAKOUT_SORT_COLUMNS.map(({ key, label }) => (
                  <th key={key} className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">
                    <button
                      onClick={() => toggleSort(key)}
                      className="flex items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      {label}
                      {sortKey === key && <span className="text-indigo-500">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Chart</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-zinc-500 dark:text-zinc-400">Analyse</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30" title={r.explanation ?? undefined}>
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-zinc-800 dark:text-zinc-200">{r.symbol.replace(/\.(NS|BO)$/, '')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">{r.scan_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
                    {r.appeared_date}
                    <span className="ml-1 text-[10px] text-zinc-400">{fmtTime(r.created_at)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-indigo-600 dark:text-indigo-400">{r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">{r.entry_price !== null ? `₹${fmt(r.entry_price)}` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">{r.target !== null ? `₹${fmt(r.target)}` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-red-500 dark:text-red-400">{r.stop_loss !== null ? `₹${fmt(r.stop_loss)}` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">{r.ltp !== null ? `₹${fmt(r.ltp)}` : '—'}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${pctCls(r.change)}`}>{r.change !== null ? r.change.toFixed(2) : '—'}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${pctCls(r.day_pnl_pct)}`}>{fmtPct(r.day_pnl_pct)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${pctCls(r.week_pnl_pct)}`}>{fmtPct(r.week_pnl_pct)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${pctCls(r.month_pnl_pct)}`}>{fmtPct(r.month_pnl_pct)}</td>
                  <td className="whitespace-nowrap px-3 py-2"><BreakoutStatusBadge status={r.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      href={`/trade?symbol=${encodeURIComponent(r.symbol)}`}
                      className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:hover:bg-indigo-950/70"
                    >
                      📈 Chart
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      href={`/stock-analysis?symbol=${encodeURIComponent(r.symbol)}`}
                      className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      🔍 Analyse
                    </Link>
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

        <BreakoutWatchlist token={tokenRef.current} />
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  listWebhooks, createWebhook, deleteWebhook, toggleWebhook,
  listWebhookDeliveries, listWebhookEvents, getWebhookEventExample, testWebhook,
} from '@/lib/api'
import type { WebhookSub, WebhookDelivery, WebhookTestResult } from '@/lib/api'

const EVENT_LABELS: Record<string, string> = {
  'alert.triggered':        'Price Alert Triggered',
  'signal.generated':       'AI Signal Generated',
  'trade.executed':         'Trade Executed',
  'discovery.scan_complete':'Discovery Scan Complete',
  'position.stop_hit':      'Stop Loss Hit',
  'position.target_hit':    'Target Hit',
}

// ── Delivery log panel ────────────────────────────────────────────────────────

function DeliveryLog({ wh, tokenRef, onClose }: {
  wh: WebhookSub
  tokenRef: React.RefObject<string>
  onClose: () => void
}) {
  const [logs, setLogs] = useState<WebhookDelivery[] | null>(null)

  useEffect(() => {
    listWebhookDeliveries(tokenRef.current, wh.id).then(setLogs).catch(() => setLogs([]))
  }, [wh.id, tokenRef])

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Delivery Log</p>
        <button onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Close</button>
      </div>
      {logs === null ? (
        <div className="flex justify-center py-4"><div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : logs.length === 0 ? (
        <p className="text-xs text-zinc-400">No deliveries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Time', 'Event', 'Status', 'Result'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((d, i) => (
                <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50">
                  <td className="px-3 py-2 text-zinc-400">
                    {new Date(d.delivered_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{EVENT_LABELS[d.event] ?? d.event}</td>
                  <td className="px-3 py-2">
                    {d.status_code ? (
                      <span className={`font-semibold ${d.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {d.status_code}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {d.ok ? (
                      <span className="text-emerald-600 dark:text-emerald-400">Delivered</span>
                    ) : (
                      <span className="text-red-500 dark:text-red-400 truncate max-w-[200px]">{d.error || 'Failed'}</span>
                    )}
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

// ── Webhook card ──────────────────────────────────────────────────────────────

function WebhookCard({
  wh, tokenRef, onDeleted, onToggled,
}: {
  wh: WebhookSub
  tokenRef: React.RefObject<string>
  onDeleted: () => void
  onToggled: (w: WebhookSub) => void
}) {
  const [showLog, setShowLog] = useState(false)
  const [testEvent, setTestEvent] = useState(wh.events[0] ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  async function handleTest() {
    setTesting(true); setTestResult(null); setTestError(null)
    try {
      const result = await testWebhook(tokenRef.current, wh.id, testEvent)
      setTestResult(result)
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Test failed')
    } finally { setTesting(false) }
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-900 ${wh.is_active ? 'border-zinc-200 dark:border-zinc-800' : 'border-zinc-100 opacity-60 dark:border-zinc-800'}`}>
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full ${wh.is_active ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{wh.name}</p>
              {wh.failure_count > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950 dark:text-red-300">
                  {wh.failure_count} failures
                </span>
              )}
            </div>
            <p className="mb-2 truncate text-xs font-mono text-zinc-500">{wh.url}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {wh.events.map(e => (
                <button
                  key={e}
                  onClick={() => { setTestEvent(e); setTestResult(null); setTestError(null) }}
                  title="Select which event to send a test for"
                  className={`rounded-md px-2 py-0.5 text-[10px] transition-colors ${
                    testEvent === e
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900'
                  }`}
                >
                  {EVENT_LABELS[e] ?? e}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400">
              Secret: <span className="font-mono">{wh.secret}</span>
              {wh.last_triggered_at && ` · Last: ${new Date(wh.last_triggered_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={handleTest}
              disabled={testing || !testEvent}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {testing ? 'Sending…' : '▶ Send Test'}
            </button>
            <button
              onClick={() => onToggled(wh)}
              className={`text-xs font-medium ${wh.is_active ? 'text-amber-600 hover:text-amber-800 dark:text-amber-400' : 'text-emerald-600 hover:text-emerald-800 dark:text-emerald-400'}`}
            >
              {wh.is_active ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => setShowLog(l => !l)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Log
            </button>
            <button onClick={onDeleted} className="text-xs text-red-400 hover:text-red-600">Delete</button>
          </div>
        </div>

        {testError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{testError}</p>
        )}
        {testResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950'
              : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
          }`}>
            <p className={testResult.ok ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-red-600 dark:text-red-300'}>
              {testResult.ok
                ? `Delivered — HTTP ${testResult.status_code}`
                : `Failed${testResult.status_code ? ` — HTTP ${testResult.status_code}` : ''}${testResult.error ? `: ${testResult.error}` : ''}`}
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded bg-white/60 p-2 font-mono text-[10px] text-zinc-600 dark:bg-black/20 dark:text-zinc-300">
              {JSON.stringify({ event: testResult.event, data: testResult.sample_payload }, null, 2)}
            </pre>
          </div>
        )}

        {showLog && (
          <DeliveryLog wh={wh} tokenRef={tokenRef} onClose={() => setShowLog(false)} />
        )}
      </div>
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateWebhookForm({ allEvents, tokenRef, onCreated }: {
  allEvents: string[]
  tokenRef: React.RefObject<string>
  onCreated: (w: WebhookSub) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [secretShown, setSecretShown] = useState<string | null>(null)
  const [previewEvent, setPreviewEvent] = useState<string | null>(null)
  const [previewJson, setPreviewJson] = useState<string | null>(null)

  async function showExample(ev: string) {
    if (previewEvent === ev) { setPreviewEvent(null); setPreviewJson(null); return }
    setPreviewEvent(ev); setPreviewJson('Loading…')
    try {
      const example = await getWebhookEventExample(tokenRef.current, ev)
      setPreviewJson(JSON.stringify(example, null, 2))
    } catch {
      setPreviewJson('Failed to load example.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim() || selectedEvents.length === 0) {
      setErr('Name, URL, and at least one event required')
      return
    }
    setBusy(true); setErr(null)
    try {
      const w = await createWebhook(tokenRef.current, { name, url, events: selectedEvents })
      setSecretShown(w.secret)
      onCreated(w)
      setName(''); setUrl(''); setSelectedEvents([])
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed') }
    finally { setBusy(false) }
  }

  const inp = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50'

  return (
    <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Register Webhook</h2>
      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
      {secretShown && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="mb-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Webhook created! Save this secret — it won't be shown again:</p>
          <p className="font-mono text-xs break-all text-emerald-800 dark:text-emerald-200">{secretShown}</p>
          <button type="button" onClick={() => setSecretShown(null)} className="mt-2 text-xs text-emerald-600 hover:text-emerald-800 dark:text-emerald-400">Dismiss</button>
        </div>
      )}
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Webhook name" className={inp} />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-endpoint.com/hook" className={inp} />
      </div>
      <p className="mb-2 text-xs font-medium text-zinc-500">Subscribe to events:</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {allEvents.map(ev => {
          const checked = selectedEvents.includes(ev)
          return (
            <div key={ev} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedEvents(prev => checked ? prev.filter(e => e !== ev) : [...prev, ev])}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  checked
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {EVENT_LABELS[ev] ?? ev}
              </button>
              <button
                type="button"
                onClick={() => showExample(ev)}
                title="View example payload"
                className={`text-xs ${previewEvent === ev ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400'}`}
              >
                {'{ }'}
              </button>
            </div>
          )
        })}
      </div>
      {previewJson && (
        <pre className="mb-4 max-h-64 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {previewJson}
        </pre>
      )}
      <button type="submit" disabled={busy}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
        {busy ? 'Creating…' : 'Register Webhook'}
      </button>
    </form>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function WebhooksView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [webhooks, setWebhooks] = useState<WebhookSub[]>([])
  const [allEvents, setAllEvents] = useState<string[]>([])
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (t: string) => {
    const [evts, list] = await Promise.all([listWebhookEvents(t), listWebhooks(t)])
    setAllEvents(evts); setWebhooks(list)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    load(t).catch(() => {})
  }, [router, load])

  async function handleDelete(id: string) {
    await deleteWebhook(tokenRef.current, id)
    setWebhooks(prev => prev.filter(w => w.id !== id))
  }

  async function handleToggle(wh: WebhookSub) {
    const updated = await toggleWebhook(tokenRef.current, wh.id)
    setWebhooks(prev => prev.map(w => w.id === wh.id ? updated : w))
  }

  if (!authChecked) return null

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Webhooks" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Webhooks</h1>
          <p className="text-xs text-zinc-400">
            Receive real-time HTTP POST notifications when alerts trigger, trades execute, or discovery scans complete.
            Requests are signed with HMAC-SHA256.
          </p>
        </div>

        <div className="space-y-5">
          <CreateWebhookForm allEvents={allEvents} tokenRef={tokenRef} onCreated={w => setWebhooks(prev => [w, ...prev])} />

          {webhooks.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">No webhooks registered yet.</p>
              <p className="mt-1 text-xs text-zinc-400">Register one above to start receiving event notifications.</p>
            </div>
          ) : (
            webhooks.map(w => (
              <WebhookCard
                key={w.id} wh={w} tokenRef={tokenRef}
                onDeleted={() => handleDelete(w.id)}
                onToggled={handleToggle}
              />
            ))
          )}
        </div>
      </main>
    </div>
  )
}

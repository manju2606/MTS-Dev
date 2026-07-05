'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getAdminStats, listAdminUsers, updateAdminUser, createAdminUser,
  listEmailRecipients, addEmailRecipient, removeEmailRecipient, toggleEmailRecipient,
  sendReportNow, getSotDSettings, updateSotDSettings,
  listAllOrgs, adminSetOrgPlan,
} from '@/lib/api'
import type { AdminStats, AdminUser, EmailRecipient, SotDSettings, OrgData } from '@/lib/api'

type Tab = 'users' | 'email-list' | 'trading-rules' | 'organizations'

function SendReportButton({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send() {
    setBusy(true); setOk(false); setErr(null)
    try {
      await sendReportNow(tokenRef.current)
      setOk(true)
      setTimeout(() => setOk(false), 4000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
      setTimeout(() => setErr(null), 4000)
    } finally { setBusy(false) }
  }

  return (
    <button
      onClick={send}
      disabled={busy}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
        ok ? 'bg-emerald-600 text-white' : err ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60'
      }`}
    >
      {busy ? 'Sending…' : ok ? 'Sent!' : err ?? 'Send Report Now'}
    </button>
  )
}

// ── Add User Form ─────────────────────────────────────────────────────────────

function AddUserForm({ onCreated, tokenRef }: { onCreated: () => void; tokenRef: React.RefObject<string> }) {
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'viewer' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email || !form.full_name || !form.password) { setErr('All fields required'); return }
    setBusy(true); setErr(null); setOk(false)
    try {
      await createAdminUser(tokenRef.current, form)
      setForm({ email: '', full_name: '', password: '', role: 'viewer' })
      setOk(true)
      onCreated()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed') }
    finally { setBusy(false) }
  }

  const inp = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50'
  const sel = inp + ' cursor-pointer'

  return (
    <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Add New User</h2>
      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
      {ok  && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">User created successfully.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className={inp} placeholder="Full name" value={form.full_name}
          onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
        <input className={inp} placeholder="Email" type="email" value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <input className={inp} placeholder="Password" type="password" value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        <select className={sel} value={form.role}
          onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          <option value="viewer">Viewer</option>
          <option value="trader">Trader</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </form>
  )
}

// ── Email List Panel ──────────────────────────────────────────────────────────

function EmailListPanel({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [recipients, setRecipients] = useState<EmailRecipient[] | null>(null)
  const [form, setForm] = useState({ email: '', label: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await listEmailRecipients(tokenRef.current)
    setRecipients(list)
  }, [tokenRef])

  useEffect(() => { load().catch(() => setRecipients([])) }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email) { setErr('Email required'); return }
    setBusy(true); setErr(null)
    try {
      await addEmailRecipient(tokenRef.current, form.email, form.label)
      setForm({ email: '', label: '' })
      await load()
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Add failed') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    try { await removeEmailRecipient(tokenRef.current, id); await load() }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Remove failed') }
  }

  async function toggle(id: string) {
    try { await toggleEmailRecipient(tokenRef.current, id); await load() }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Toggle failed') }
  }

  const inp = 'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50'

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Add Report Recipient</h2>
        <p className="mb-4 text-xs text-zinc-400">
          All active recipients receive the hourly discovery email (8:15 AM – 3:15 PM IST on weekdays).
        </p>
        {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
        <form onSubmit={add} className="flex flex-wrap gap-3">
          <input className={inp + ' flex-1 min-w-[200px]'} placeholder="Email address" type="email"
            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className={inp + ' w-40'} placeholder="Label (optional)"
            value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>

      {/* List */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Recipients ({recipients?.length ?? 0})
          </p>
        </div>
        {recipients === null ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : recipients.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-400">
            No recipients yet. Add one above — the hourly report will be sent to all active emails.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                {['Email', 'Label', 'Status', 'Added', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recipients.map(r => (
                <tr key={r.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{r.email}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{r.label || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      r.active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
                    }`}>
                      {r.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {new Date(r.added_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => toggle(r.id)}
                        className={`text-xs ${r.active ? 'text-amber-700 hover:text-amber-900 dark:text-amber-500 dark:hover:text-amber-400' : 'text-emerald-700 hover:text-emerald-900 dark:text-emerald-500 dark:hover:text-emerald-400'}`}>
                        {r.active ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => remove(r.id)}
                        className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Trading Rules Panel ───────────────────────────────────────────────────────

function TradingRulesPanel({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [cfg, setCfg]     = useState<SotDSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    getSotDSettings(tokenRef.current).then(setCfg).catch(() => null)
  }, [tokenRef])

  async function save() {
    if (!cfg) return
    setSaving(true); setMsg(null)
    try {
      const saved = await updateSotDSettings(tokenRef.current, cfg)
      setCfg(saved)
      setMsg({ text: 'Settings saved.', ok: true })
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false })
    } finally { setSaving(false) }
  }

  const inp = 'rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'

  if (!cfg) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Stock of Day auto-trade */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Stock of Day — Auto-Trade Rules</h2>
        <p className="mb-5 text-xs text-zinc-400">
          Controls when the system automatically places a paper trade for the daily AI pick.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Enable toggle */}
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Auto-Trade</p>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Enabled</span>
              <input
                type="checkbox"
                checked={cfg.auto_trade_enabled}
                onChange={e => setCfg({ ...cfg, auto_trade_enabled: e.target.checked })}
                className="h-4 w-4 rounded accent-indigo-600"
              />
            </label>
            <p className="mt-2 text-[10px] text-zinc-400">
              When disabled, no paper trades are placed automatically — picks are still generated.
            </p>
          </div>

          {/* Confidence threshold */}
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Confidence Score Threshold</p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={50} max={100} step={1}
                value={cfg.threshold}
                onChange={e => setCfg({ ...cfg, threshold: Number(e.target.value) })}
                className={inp + ' w-24'}
              />
              <span className="text-sm text-zinc-500">/ 100</span>
            </div>
            <p className="mt-2 text-[10px] text-zinc-400">
              Trade is placed only if AI composite score ≥ this value. Range: 50–100.
            </p>
          </div>

          {/* Max trades per day */}
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Max Trades per Day</p>
            <input
              type="number" min={1} max={10} step={1}
              value={cfg.max_daily_trades}
              onChange={e => setCfg({ ...cfg, max_daily_trades: Number(e.target.value) })}
              className={inp + ' w-24'}
            />
            <p className="mt-2 text-[10px] text-zinc-400">
              Maximum auto-trades allowed per calendar day. Range: 1–10.
            </p>
          </div>

          {/* Market hours only */}
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Market Hours Only</p>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">9:15 – 15:30 IST weekdays</span>
              <input
                type="checkbox"
                checked={cfg.market_hours_only}
                onChange={e => setCfg({ ...cfg, market_hours_only: e.target.checked })}
                className="h-4 w-4 rounded accent-indigo-600"
              />
            </label>
            <p className="mt-2 text-[10px] text-zinc-400">
              When enabled, trades outside NSE trading hours are blocked.
            </p>
          </div>

          {/* Paper trade quantity — qty or % of capital */}
          <div className="col-span-full rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50 sm:col-span-2 lg:col-span-3">
            <p className="mb-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Position Size</p>

            {/* Toggle */}
            <div className="mb-4 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
              {(['qty', 'pct'] as const).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setCfg({ ...cfg, quantity_type: opt })}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                    cfg.quantity_type === opt
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {opt === 'qty' ? 'Fixed Qty' : '% of Capital'}
                </button>
              ))}
            </div>

            {cfg.quantity_type === 'qty' ? (
              <div className="flex items-end gap-6">
                <div>
                  <p className="mb-1 text-[10px] text-zinc-400 uppercase">Shares per trade</p>
                  <input
                    type="number" min={1} max={10000} step={1}
                    value={cfg.paper_trade_quantity}
                    onChange={e => setCfg({ ...cfg, paper_trade_quantity: Number(e.target.value) })}
                    className={inp + ' w-28'}
                  />
                  <p className="mt-1.5 text-[10px] text-zinc-400">Fixed number of shares, 1–10,000.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <p className="mb-1 text-[10px] text-zinc-400 uppercase">% of capital per trade</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0.1} max={100} step={0.1}
                      value={cfg.paper_trade_quantity}
                      onChange={e => setCfg({ ...cfg, paper_trade_quantity: Number(e.target.value) })}
                      className={inp + ' w-24'}
                    />
                    <span className="text-sm text-zinc-500">%</span>
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-400">0.1–100% of the virtual capital below.</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] text-zinc-400 uppercase">Virtual capital (₹)</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500">₹</span>
                    <input
                      type="number" min={1000} max={100000000} step={1000}
                      value={cfg.paper_capital}
                      onChange={e => setCfg({ ...cfg, paper_capital: Number(e.target.value) })}
                      className={inp + ' w-36'}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-400">
                    Qty = floor(capital × % ÷ entry price). Min 1 share.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <button
            onClick={save} disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {msg && (
            <p className={`text-xs font-medium ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
              {msg.ok ? '✓ ' : '✕ '}{msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Organizations Panel ───────────────────────────────────────────────────────

const PLAN_META = {
  free:       { label: 'Free',       color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',          users: 1,    capital: '₹1L',   live: false },
  pro:        { label: 'Pro',        color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',  users: 5,    capital: '₹10L',  live: true  },
  enterprise: { label: 'Enterprise', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',      users: '∞',  capital: '∞',     live: true  },
} as const

function OrgPanel({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [orgs, setOrgs] = useState<OrgData[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    listAllOrgs(tokenRef.current)
      .then(setOrgs)
      .catch(e => setErr(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [tokenRef])

  async function changePlan(orgId: string, plan: string) {
    setUpdatingId(orgId); setErr(null)
    try {
      const updated = await adminSetOrgPlan(tokenRef.current, orgId, plan)
      setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, plan: updated.plan, limits: updated.limits } : o))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed') }
    finally { setUpdatingId(null) }
  }

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />)}</div>

  return (
    <div className="space-y-5">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}

      {/* Plan comparison */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(Object.entries(PLAN_META) as [string, typeof PLAN_META[keyof typeof PLAN_META]][]).map(([key, meta]) => (
          <div key={key} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${meta.color}`}>{meta.label}</span>
            </div>
            <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
              <p><span className="text-zinc-400">Users:</span> {typeof meta.users === 'number' ? meta.users : meta.users}</p>
              <p><span className="text-zinc-400">Max Capital:</span> {meta.capital}</p>
              <p><span className="text-zinc-400">Live Trading:</span> {meta.live ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span> : <span className="text-zinc-400">No</span>}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Org table */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">All Organizations ({orgs.length})</p>
        </div>

        {orgs.length === 0 ? (
          <p className="px-5 py-8 text-sm text-zinc-400">No organizations created yet. Users create orgs from their profile.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {['Name', 'Plan', 'Members', 'Live Trading', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-zinc-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.map(org => {
                  const meta = PLAN_META[org.plan as keyof typeof PLAN_META] ?? PLAN_META.free
                  return (
                    <tr key={org.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                      <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">{org.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${meta.color}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {org.member_count}
                        {org.limits.max_users !== -1 && <span className="text-zinc-300"> / {org.limits.max_users}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {org.limits.live_trading
                          ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                          : <span className="text-zinc-400">No</span>}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {new Date(org.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={org.plan}
                          disabled={updatingId === org.id}
                          onChange={e => changePlan(org.id, e.target.value)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 disabled:opacity-50 cursor-pointer"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Admin View ───────────────────────────────────────────────────────────

export default function AdminView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [tab, setTab] = useState<Tab>('users')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const loadUsers = useCallback(async (token: string) => {
    const [s, u] = await Promise.all([getAdminStats(token), listAdminUsers(token)])
    setStats(s); setUsers(u)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const run = async () => {
      setAuthChecked(true)
      try { await loadUsers(t) }
      catch (err) { setMsg(err instanceof Error ? err.message : 'Load failed') }
    }
    void run()
  }, [router, loadUsers])

  async function toggleActive(user: AdminUser) {
    setLoading(true)
    try {
      await updateAdminUser(tokenRef.current, user.id, { is_active: !user.is_active })
      await loadUsers(tokenRef.current)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Update failed') }
    finally { setLoading(false) }
  }

  async function changeRole(user: AdminUser, role: string) {
    setLoading(true)
    try {
      await updateAdminUser(tokenRef.current, user.id, { role })
      await loadUsers(tokenRef.current)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Update failed') }
    finally { setLoading(false) }
  }

  if (!authChecked) return null

  const roleColor = (r: string) =>
    r === 'admin' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
    : r === 'trader' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Admin" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Admin Panel</h1>
          <SendReportButton tokenRef={tokenRef} />
        </div>

        {msg && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {msg}
            <button onClick={() => setMsg(null)} className="ml-3 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">✕</button>
          </div>
        )}

        {/* Stats row */}
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Total Users', value: stats.total_users },
              { label: 'Active Users', value: stats.active_users },
              { label: 'Total Trades', value: stats.total_trades },
              { label: 'Open Trades', value: stats.open_trades },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Role breakdown pills */}
        {stats?.users_by_role && (
          <div className="mb-6 flex flex-wrap gap-2">
            {Object.entries(stats.users_by_role).map(([role, count]) => (
              <span key={role} className={`rounded-full px-3 py-1 text-xs font-semibold ${roleColor(role)}`}>
                {role}: {count}
              </span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex border-b border-zinc-200 dark:border-zinc-800">
          {([
            { key: 'users', label: 'User Management' },
            { key: 'email-list', label: 'Email List' },
            { key: 'trading-rules', label: 'Trading Rules' },
            { key: 'organizations', label: 'Organizations' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`mr-6 border-b-2 pb-3 text-sm font-semibold transition-colors ${
                tab === key
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {tab === 'users' && (
          <div className="space-y-5">
            <AddUserForm tokenRef={tokenRef} onCreated={() => loadUsers(tokenRef.current)} />

            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">All Users ({users.length})</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Name', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">{u.full_name}</td>
                        <td className="px-4 py-3 text-zinc-500">{u.email}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={loading}
                            onChange={e => changeRole(u, e.target.value)}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border-0 cursor-pointer ${roleColor(u.role)}`}
                          >
                            <option value="admin">admin</option>
                            <option value="trader">trader</option>
                            <option value="viewer">viewer</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'}`}>
                            {u.is_active ? 'active' : 'inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {new Date(u.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={loading}
                            className={`text-xs ${u.is_active ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300' : 'text-emerald-700 hover:text-emerald-900 dark:text-emerald-500 dark:hover:text-emerald-400'}`}
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Email List tab */}
        {tab === 'email-list' && <EmailListPanel tokenRef={tokenRef} />}

        {/* Trading Rules tab */}
        {tab === 'trading-rules' && <TradingRulesPanel tokenRef={tokenRef} />}

        {/* Organizations tab */}
        {tab === 'organizations' && <OrgPanel tokenRef={tokenRef} />}
      </main>
    </div>
  )
}

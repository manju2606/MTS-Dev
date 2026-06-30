'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getAdminStats, listAdminUsers, updateAdminUser, createAdminUser,
  listEmailRecipients, addEmailRecipient, removeEmailRecipient, toggleEmailRecipient,
} from '@/lib/api'
import type { AdminStats, AdminUser, EmailRecipient } from '@/lib/api'

type Tab = 'users' | 'email-list'

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
                    {new Date(r.added_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => toggle(r.id)}
                        className={`text-xs ${r.active ? 'text-amber-500 hover:text-amber-600' : 'text-emerald-500 hover:text-emerald-600'}`}>
                        {r.active ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => remove(r.id)}
                        className="text-xs text-red-400 hover:text-red-600">
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
        <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Admin Panel</h1>

        {msg && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {msg}
            <button onClick={() => setMsg(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
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
                          {new Date(u.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={loading}
                            className={`text-xs ${u.is_active ? 'text-red-400 hover:text-red-600' : 'text-emerald-500 hover:text-emerald-600'}`}
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
      </main>
    </div>
  )
}

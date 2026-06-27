'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getAdminStats, listAdminUsers, updateAdminUser } from '@/lib/api'
import type { AdminStats, AdminUser } from '@/lib/api'

export default function AdminView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (token: string) => {
    const [s, u] = await Promise.all([getAdminStats(token), listAdminUsers(token)])
    setStats(s); setUsers(u)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    load(t).catch(err => setMsg(err instanceof Error ? err.message : 'Load failed'))
  }, [router, load])

  async function toggleActive(user: AdminUser) {
    setLoading(true)
    try {
      await updateAdminUser(tokenRef.current, user.id, { is_active: !user.is_active })
      await load(tokenRef.current)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Update failed') }
    finally { setLoading(false) }
  }

  async function changeRole(user: AdminUser, role: string) {
    setLoading(true)
    try {
      await updateAdminUser(tokenRef.current, user.id, { role })
      await load(tokenRef.current)
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
          </div>
        )}

        {/* Stats row */}
        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
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

        {/* Role breakdown */}
        {stats?.users_by_role && (
          <div className="mb-8 flex gap-3">
            {Object.entries(stats.users_by_role).map(([role, count]) => (
              <span key={role} className={`rounded-full px-3 py-1 text-xs font-semibold ${roleColor(role)}`}>
                {role}: {count}
              </span>
            ))}
          </div>
        )}

        {/* User table */}
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Users ({users.length})</p>
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
      </main>
    </div>
  )
}

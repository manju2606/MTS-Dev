'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { createApiKey, getUsage, listApiKeys, revokeApiKey } from '@/lib/api'
import type { ApiKey, CreatedApiKey, UsageInfo } from '@/lib/api'

const TIER_LABEL: Record<string, string> = {
  free: 'Free (10 AI calls/day)',
  basic: 'Basic (100 AI calls/day)',
  pro: 'Pro (unlimited)',
}

export default function ApiKeysView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    Promise.all([listApiKeys(t), getUsage(t)])
      .then(([ks, u]) => { setKeys(ks); setUsage(u) })
      .catch(() => null)
  }, [router])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true); setError(null); setCreated(null)
    try {
      const key = await createApiKey(tokenRef.current, newName.trim())
      setCreated(key)
      setKeys(prev => [key, ...prev])
      setNewName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key')
    } finally { setCreating(false) }
  }

  async function handleRevoke(id: string) {
    try {
      await revokeApiKey(tokenRef.current, id)
      setKeys(prev => prev.filter(k => k.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key')
    }
  }

  function copyKey() {
    if (!created?.raw_key) return
    navigator.clipboard.writeText(created.raw_key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="API Keys" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">API Keys</h1>
          <p className="text-xs text-zinc-400">
            Use API keys to authenticate programmatic access — pass as{' '}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">X-API-Key: mts_…</code>{' '}
            header. Keys are shown once on creation.
          </p>
        </div>

        {/* Subscription + usage */}
        {usage && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Plan & Usage</p>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-zinc-400">Subscription</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200 capitalize">
                  {TIER_LABEL[usage.tier] ?? usage.tier}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">AI Calls Today</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {usage.calls_today} / {usage.limit === 9999 ? '∞' : usage.limit}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Remaining</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {usage.limit === 9999 ? '∞' : usage.remaining}
                </p>
              </div>
            </div>
            {usage.calls_today > 0 && usage.limit < 9999 && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(100, (usage.calls_today / usage.limit) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Created key banner (shown once) */}
        {created && (
          <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="mb-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              Key created — copy it now
            </p>
            <p className="mb-3 text-xs text-emerald-700 dark:text-emerald-300">
              This is the only time the full key is shown. Store it securely.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs font-mono text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                {created.raw_key}
              </code>
              <button
                onClick={copyKey}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setCreated(null)}
              className="mt-3 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create key form */}
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Create New Key</p>
          {error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-300">{error}</p>
          )}
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              required
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Key name (e.g. My Trading Bot)"
              maxLength={100}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>

        {/* Key list */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Active Keys</p>
          {keys.length === 0 ? (
            <p className="text-xs text-zinc-400">No API keys yet. Create one above.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {['Name', 'Prefix', 'Created', 'Last Used', ''].map(h => (
                    <th key={h} className="pb-2 text-left font-medium text-zinc-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="py-2 font-medium text-zinc-900 dark:text-zinc-50">{k.name}</td>
                    <td className="py-2 font-mono text-zinc-500">mts_{k.key_prefix}…</td>
                    <td className="py-2 text-zinc-500">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-zinc-500">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}

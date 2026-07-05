'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, clearNotifications,
} from '@/lib/api'
import type { AppNotification } from '@/lib/api'

const TYPE_STYLES: Record<string, { dot: string; badge: string }> = {
  'alert.triggered':       { dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  'trade.executed':        { dot: 'bg-emerald-500',  badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  'signal.generated':      { dot: 'bg-indigo-500',   badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' },
  'strategy.condition_met':{ dot: 'bg-violet-500',   badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' },
  'risk.limit_breached':   { dot: 'bg-red-500',      badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
  'system.info':           { dot: 'bg-zinc-400',     badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
}

const TYPE_LABELS: Record<string, string> = {
  'alert.triggered':        'Price Alert',
  'trade.executed':         'Trade Executed',
  'signal.generated':       'AI Signal',
  'strategy.condition_met': 'Strategy Hit',
  'risk.limit_breached':    'Risk Breach',
  'system.info':            'System',
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function NotificationRow({
  n, tokenRef, onRead,
}: {
  n: AppNotification
  tokenRef: React.RefObject<string>
  onRead: (id: string) => void
}) {
  const style = TYPE_STYLES[n.type] ?? TYPE_STYLES['system.info']
  const label = TYPE_LABELS[n.type] ?? n.type

  async function handleRead() {
    if (!n.read) {
      await markNotificationRead(tokenRef.current, n.id).catch(() => {})
      onRead(n.id)
    }
  }

  return (
    <div
      onClick={handleRead}
      className={`group flex gap-3 rounded-xl border px-4 py-3.5 transition-colors cursor-pointer ${
        n.read
          ? 'border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900'
          : 'border-indigo-100 bg-indigo-50/60 dark:border-indigo-900/50 dark:bg-indigo-950/30'
      }`}
    >
      <div className="mt-1 shrink-0">
        <span className={`block h-2 w-2 rounded-full ${style.dot} ${n.read ? 'opacity-30' : ''}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>
            {label}
          </span>
          <span className="text-[10px] text-zinc-400">{relTime(n.created_at)}</span>
          {!n.read && (
            <span className="ml-auto text-[10px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
              Mark read
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">{n.title}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{n.body}</p>
      </div>
    </div>
  )
}

export default function NotificationsView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)

  const load = useCallback(async (t: string) => {
    const data = await listNotifications(t)
    setItems(data)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    load(t).catch(() => {}).finally(() => setLoading(false))
  }, [router, load])

  function handleRead(id: string) {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  async function handleReadAll() {
    await markAllNotificationsRead(tokenRef.current).catch(() => {})
    setItems(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function handleClear() {
    await clearNotifications(tokenRef.current).catch(() => {})
    setItems([])
  }

  if (!authChecked) return null

  const unread = items.filter(n => !n.read).length

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Notifications" />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Notifications
              {unread > 0 && (
                <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
                  {unread}
                </span>
              )}
            </h1>
            <p className="text-xs text-zinc-400">Price alerts, trade events, and system messages</p>
          </div>
          <div className="flex gap-2">
            {unread > 0 && (
              <button
                onClick={handleReadAll}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Mark all read
              </button>
            )}
            {items.length > 0 && (
              <button
                onClick={handleClear}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:border-zinc-700 dark:hover:bg-red-950/30"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-2xl mb-2">🔔</p>
            <p className="text-sm font-medium text-zinc-500">No notifications yet</p>
            <p className="mt-1 text-xs text-zinc-400">
              Price alerts, trade confirmations, and AI signals will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(n => (
              <NotificationRow
                key={n.id}
                n={n}
                tokenRef={tokenRef}
                onRead={handleRead}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

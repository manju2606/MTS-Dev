'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'

const OPS_URL = process.env.NEXT_PUBLIC_OPS_DASHBOARD_URL || 'http://localhost:4600'

type Status = 'checking' | 'up' | 'down'

// Most endpoints return { status: 'up' | 'down', ... }. /api/monitoring/status
// instead returns one status per service ({ grafana: {...}, prometheus: {...}, ... }) —
// treat that as "up" only if every service in it is up.
function extractStatus(data: Record<string, unknown>): Status {
  if (data.status === 'up') return 'up'
  if (data.status === 'down') return 'down'
  const services = Object.values(data) as { status?: string }[]
  if (services.length > 0 && services.every(s => s?.status === 'up')) return 'up'
  return 'down'
}

async function fetchStatus(path: string): Promise<Status> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(`${OPS_URL}${path}`, { signal: controller.signal })
    clearTimeout(t)
    if (!res.ok) return 'down'
    const data = await res.json()
    return extractStatus(data)
  } catch {
    clearTimeout(t)
    return 'down'
  }
}

function StatusDot({ status }: { status: Status }) {
  const color =
    status === 'up' ? 'bg-emerald-500' : status === 'down' ? 'bg-red-500' : 'bg-zinc-400'
  const label = status === 'up' ? 'up' : status === 'down' ? 'down' : 'checking…'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function OpsCard({
  title, desc, page, statusPath, accent,
}: { title: string; desc: string; page: string; statusPath: string; accent: string }) {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false
    fetchStatus(statusPath).then(s => { if (!cancelled) setStatus(s) })
    return () => { cancelled = true }
  }, [statusPath])

  return (
    <a href={`${OPS_URL}/${page}`} target="_blank" rel="noopener noreferrer">
      <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
        <div className={`mb-3 h-1.5 w-10 rounded-full ${accent}`} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
          <StatusDot status={status} />
        </div>
        <p className="mt-1 flex-1 text-xs text-zinc-500 dark:text-zinc-400">{desc}</p>
        <span className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Open →</span>
      </div>
    </a>
  )
}

export default function MtsOpsView() {
  const router = useRouter()
  const tokenRef = useRef('')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
  }, [router])

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MTS Ops" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">MTS Ops</h1>
            <p className="text-xs text-zinc-400">
              Local dev stack health — data stores, application services, the kind cluster,
              and the metrics stack, all in one place.
            </p>
          </div>
          <a
            href={OPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Open full dashboard →
          </a>
        </div>

        <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
          These open in a new tab and only work from this machine. Start it with{' '}
          <code className="rounded bg-white/60 px-1 dark:bg-black/20">make ops-dashboard-docker</code>{' '}
          — it works against both the dev and prod compose stacks.
        </div>

        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Data Stores</div>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <OpsCard
            title="PostgreSQL"
            desc="User accounts, trades, portfolio positions, audit logs — connection status, size, table row counts."
            page="postgres.html"
            statusPath="/api/postgres/status"
            accent="bg-blue-400"
          />
          <OpsCard
            title="Redis"
            desc="Real-time price cache, session store, rate limiting — ping, key count, memory usage."
            page="redis.html"
            statusPath="/api/redis/status"
            accent="bg-red-400"
          />
          <OpsCard
            title="MongoDB"
            desc="Trade journal entries, AI explanation logs — database list and sizes."
            page="mongodb.html"
            statusPath="/api/mongodb/status"
            accent="bg-emerald-400"
          />
        </div>

        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Application</div>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <OpsCard
            title="Services"
            desc="Backend API and frontend health checks, response latency."
            page="services.html"
            statusPath="/api/services/status"
            accent="bg-cyan-400"
          />
          <OpsCard
            title="Kubernetes"
            desc="mts-dev kind cluster — nodes, pods, deployments and services in the mts namespace."
            page="kubernetes.html"
            statusPath="/api/k8s/summary"
            accent="bg-violet-400"
          />
        </div>

        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Monitoring</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <OpsCard
            title="Grafana · Prometheus · Alertmanager"
            desc="Metrics dashboards, raw metrics and alert routing — only up when the prod compose stack is running."
            page="index.html"
            statusPath="/api/monitoring/status"
            accent="bg-amber-400"
          />
        </div>
      </main>
    </div>
  )
}

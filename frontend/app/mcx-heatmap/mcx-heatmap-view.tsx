'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'

const MCX_HEATMAP_URL = 'https://www.mcxindia.com/market-data/heatmap'

export default function McxHeatmapView() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('mts_token')
    if (!token) { router.replace('/login'); return }
    const id = setTimeout(() => setReady(true), 0)
    return () => clearTimeout(id)
  }, [router])

  if (!ready) return null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX Heatmap" />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">MCX Heatmap</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Live commodity-wide heatmap from MCX India&apos;s own site — covers all MCX segments
              (bullion, energy, base metals), not just Natural Gas.
            </p>
          </div>
          <a
            href={MCX_HEATMAP_URL}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Open on mcxindia.com ↗
          </a>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          This embeds MCX India&apos;s own page directly — we don&apos;t control or modify it. If the box below
          stays blank, MCX India&apos;s site is blocking the embed (common for financial sites); use
          &ldquo;Open on mcxindia.com ↗&rdquo; above instead.
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <iframe
            src={MCX_HEATMAP_URL}
            title="MCX India Heatmap"
            className="h-[80vh] w-full"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      </main>
    </div>
  )
}

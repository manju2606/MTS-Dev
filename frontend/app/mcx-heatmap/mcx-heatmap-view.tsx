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
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">MCX Heatmap</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
            The live commodity-wide heatmap (bullion, energy, base metals) is on MCX India&apos;s
            own site. Their site blocks being embedded elsewhere (confirmed: it returns 403 to
            embedding attempts), so this opens it directly instead of showing a dead frame.
          </p>
          <a
            href={MCX_HEATMAP_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Open MCX Heatmap on mcxindia.com ↗
          </a>
          <p className="mt-6 text-xs text-zinc-400">
            For Natural Gas specifically — quotes, AI signal, predictions — see the{' '}
            <a href="/mcx" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Natural Gas</a> page.
          </p>
        </div>
      </main>
    </div>
  )
}

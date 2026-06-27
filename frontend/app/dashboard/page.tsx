import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard — Manju Trade AI Pro',
}

export default function DashboardPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Coming in Phase 1 — Market Scanner is next.</p>
      </div>
    </div>
  )
}

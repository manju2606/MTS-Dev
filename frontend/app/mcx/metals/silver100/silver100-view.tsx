'use client'

import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { PineAlertsCard } from '@/components/pine-alerts-card'
import { SilverStrategyPanel } from '../metals-view'

const SUB_NAV = [
  { href: '/mcx/metals/silver100', label: 'Live Signal' },
  { href: '/mcx/metals/silver100/history', label: 'History' },
  { href: '/mcx/metals/silver100/monitoring', label: 'Monitoring' },
]

export function Silver100SubNav({ active }: { active: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link
        href="/mcx/metals"
        className="mr-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        ← All Metals
      </Link>
      {SUB_NAV.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={
            active === item.label
              ? 'rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white'
              : 'rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
          }
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

export default function Silver100View() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Silver100 — MTS Silver Strategy</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Live multi-timeframe BUY/SELL signal for MCX Silver100 futures, with a plain-language
          explanation of why.
        </p>

        <div className="mt-6">
          <Silver100SubNav active="Live Signal" />
          <SilverStrategyPanel contract="SILVER100" showBacktest={false} showSignalsTable={false} showDedicatedLink={false} />
          <PineAlertsCard contract="SILVER100" />
        </div>
      </div>
    </div>
  )
}

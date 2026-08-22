'use client'

import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { PineAlertsCard } from '@/components/pine-alerts-card'
import { GoldStrategyPanel } from '../metals-view'

const SUB_NAV = [
  { href: '/mcx/metals/goldguinea', label: 'Live Signal' },
  { href: '/mcx/metals/goldguinea/history', label: 'History' },
  { href: '/mcx/metals/goldguinea/monitoring', label: 'Monitoring' },
]

export function GoldGuineaSubNav({ active }: { active: string }) {
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

export default function GoldGuineaView() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Gold Guinea — MTS Gold Strategy</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Live multi-timeframe BUY/SELL signal for MCX Gold Guinea futures, with a plain-language explanation
          of why.
        </p>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          This page runs the app&apos;s own MTS Gold Strategy engine (1H trend → 15M setup → 5M entry scoring,
          built in Python and already used for all five gold contracts) — it is <b>not</b> a port of your
          &quot;MTS Gold Guinea V2.9&quot; Pine Script on TradingView. The two are independent and can disagree.
        </div>

        <div className="mt-6">
          <GoldGuineaSubNav active="Live Signal" />
          <GoldStrategyPanel contract="GOLDGUINEA" showBacktest={false} showSignalsTable={false} showDedicatedLink={false} />
          <PineAlertsCard contract="GOLDGUINEA" />
        </div>
      </div>
    </div>
  )
}

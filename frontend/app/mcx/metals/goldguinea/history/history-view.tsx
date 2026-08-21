'use client'

import { NavBar } from '@/components/nav-bar'
import { GoldBacktestCard, GoldStrategySignalsTable } from '../../metals-view'
import { GoldGuineaSubNav } from '../goldguinea-view'

export default function GoldGuineaHistoryView() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Gold Guinea — History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every signal the MTS Gold Strategy has logged for Gold Guinea, with outcomes and accuracy — plus a
          backtest against this account&apos;s own closed signals.
        </p>

        <div className="mt-6 space-y-6">
          <GoldGuineaSubNav active="History" />
          <GoldBacktestCard contract="GOLDGUINEA" />
          <GoldStrategySignalsTable contract="GOLDGUINEA" />
        </div>
      </div>
    </div>
  )
}

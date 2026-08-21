'use client'

import { NavBar } from '@/components/nav-bar'
import { SilverBacktestCard, SilverStrategySignalsTable } from '../../metals-view'
import { Silver100SubNav } from '../silver100-view'

export default function Silver100HistoryView() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Silver100 — History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every signal the MTS Silver Strategy has logged for Silver100, with outcomes and accuracy
          — plus a backtest against this account&apos;s own closed signals.
        </p>

        <div className="mt-6 space-y-6">
          <Silver100SubNav active="History" />
          <SilverBacktestCard contract="SILVER100" />
          <SilverStrategySignalsTable contract="SILVER100" />
        </div>
      </div>
    </div>
  )
}

'use client'

import { NavBar } from '@/components/nav-bar'
import { GasBacktestCard, GasStrategySignalsTable, NgMiniSubNav } from '../ngmini-view'

export default function NgMiniHistoryView() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">NG Mini — History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every signal the MTS Natural Gas Strategy has logged for NGMINI, with outcomes and accuracy
          — plus a backtest against this account&apos;s own closed signals.
        </p>

        <div className="mt-6 space-y-6">
          <NgMiniSubNav active="History" />
          <GasBacktestCard />
          <GasStrategySignalsTable />
        </div>
      </div>
    </div>
  )
}

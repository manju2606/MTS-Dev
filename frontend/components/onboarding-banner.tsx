'use client'

import { useState } from 'react'
import Link from 'next/link'

type Step = { n: number; title: string; desc: string; href?: string; action?: string }

const STEPS: Step[] = [
  {
    n: 1,
    title: 'Seed your watchlist',
    desc: 'Click "Seed Defaults" to add 10 popular NSE stocks to your first watchlist.',
    action: 'seed',
  },
  {
    n: 2,
    title: 'Get AI analysis',
    desc: 'Head to AI Analysis and click "Analyse All" to see BUY/SELL/HOLD signals.',
    href: '/ai',
  },
  {
    n: 3,
    title: 'Place a paper trade',
    desc: 'Click "Trade it →" on any recommendation, review the risk check, and submit.',
    href: '/paper',
  },
  {
    n: 4,
    title: 'Track your P&L',
    desc: 'The Portfolio page shows live unrealized P&L, equity curve, and sector breakdown.',
    href: '/portfolio',
  },
]

export function OnboardingBanner({
  onSeed,
  onDismiss,
}: {
  onSeed: () => void
  onDismiss: () => void
}) {
  const [done, setDone] = useState<number[]>([])

  function markDone(n: number) {
    setDone(prev => [...prev, n])
  }

  const allDone = done.length >= STEPS.length

  return (
    <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-indigo-950/40">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            Welcome to Manju Trade AI Pro
          </h2>
          <p className="text-xs text-indigo-600 dark:text-indigo-400">
            Follow these steps to get started in under 2 minutes.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-indigo-400 hover:text-indigo-600 dark:text-indigo-500 dark:hover:text-indigo-300"
        >
          ×
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(step => {
          const isDone = done.includes(step.n)
          return (
            <div
              key={step.n}
              className={`rounded-xl border p-4 transition-colors ${
                isDone
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                  : 'border-indigo-200 bg-white dark:border-indigo-700 dark:bg-zinc-900'
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-indigo-600 text-white'
                  }`}
                >
                  {isDone ? '✓' : step.n}
                </span>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  {step.title}
                </span>
              </div>
              <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">{step.desc}</p>
              {!isDone && (
                step.action === 'seed' ? (
                  <button
                    onClick={() => { onSeed(); markDone(step.n) }}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    Seed Defaults →
                  </button>
                ) : step.href ? (
                  <Link
                    href={step.href}
                    onClick={() => markDone(step.n)}
                    className="inline-block rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    Go →
                  </Link>
                ) : null
              )}
            </div>
          )
        })}
      </div>

      {allDone && (
        <p className="mt-4 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
          All steps complete! You're ready to trade.
          <button onClick={onDismiss} className="ml-2 underline">Dismiss</button>
        </p>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/nav-bar'
import { getMcxCorrelation } from '@/lib/api'
import type { McxCorrelation } from '@/lib/api'

const CONTRACTS = ['GOLDGUINEA', 'SILVER100', 'NGMINI']
const LABELS: Record<string, string> = {
  GOLDGUINEA: 'Gold Guinea', SILVER100: 'Silver100', NGMINI: 'NG Mini',
}
const WINDOWS = [7, 14, 30, 60, 90]
const CALL_TIMEOUT_MS = 20_000

function cls(...args: (string | false | null | undefined)[]) { return args.filter(Boolean).join(' ') }

// A hung network request has no default timeout in fetch(), so without this
// a single stalled call leaves the page stuck on "Computing..." forever --
// same fix as the per-instrument Monitoring pages use.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}

// Diverging red -> white -> green, matching the sign/strength of the
// correlation coefficient (-1..+1) so the matrix reads as a heatmap at a
// glance, not just numbers.
function cellStyle(v: number): React.CSSProperties {
  const t = Math.max(-1, Math.min(1, v))
  if (t >= 0) {
    const alpha = t * 0.75
    return { backgroundColor: `rgba(16, 185, 129, ${alpha})` }
  }
  const alpha = -t * 0.75
  return { backgroundColor: `rgba(239, 68, 68, ${alpha})` }
}

function strengthLabel(v: number): string {
  const a = Math.abs(v)
  const dir = v >= 0 ? 'positive' : 'negative'
  if (a >= 0.7) return `strong ${dir}`
  if (a >= 0.4) return `moderate ${dir}`
  if (a >= 0.2) return `weak ${dir}`
  return 'negligible'
}

export default function McxCorrelationView() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<McxCorrelation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const t = localStorage.getItem('mts_token') ?? ''
    if (!t) return
    setLoading(true); setError(null)
    try {
      const res = await withTimeout(getMcxCorrelation(t, CONTRACTS, days), CALL_TIMEOUT_MS, 'Correlation')
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute correlation')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const pairs: { a: string; b: string; v: number }[] = []
  if (data) {
    for (let i = 0; i < data.symbols.length; i++) {
      for (let j = i + 1; j < data.symbols.length; j++) {
        pairs.push({ a: data.symbols[i], b: data.symbols[j], v: data.matrix[i][j] })
      }
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="MCX" />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">MCX Correlation</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          How Gold Guinea, Silver100, and NG Mini move relative to each other — Pearson correlation of
          5-minute-candle returns, computed from the candle history this app already collects for each contract.
        </p>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href="/mcx/metals/goldguinea" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
            Gold Guinea →
          </Link>
          <Link href="/mcx/metals/silver100" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
            Silver100 →
          </Link>
          <Link href="/mcx/ngmini" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
            NG Mini →
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Window:</span>
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={cls(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                days === w
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
              )}
            >
              {w}d
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? 'Computing…' : 'Refresh Now'}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>
        )}

        {loading && !data && (
          <div className="mt-6 h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
        )}

        {data && data.symbols.length === 0 && !loading && (
          <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Not enough candle history yet</p>
            <p className="mt-1 text-xs text-zinc-500">
              The app collects 5-minute candles for Gold Guinea, Silver100, and NG Mini in the background —
              correlation needs at least a few days of overlapping history for all three before it can compute
              anything meaningful. Check back once the market&apos;s been open a while.
            </p>
          </div>
        )}

        {data && data.symbols.length > 0 && (
          <div className="mt-6 space-y-6">
            <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full border-collapse text-center text-xs">
                <thead>
                  <tr>
                    <th className="p-2" />
                    {data.symbols.map(s => (
                      <th key={s} className="p-2 font-semibold text-zinc-600 dark:text-zinc-300">{LABELS[s] ?? s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.symbols.map((rowSym, i) => (
                    <tr key={rowSym}>
                      <th className="p-2 text-right font-semibold text-zinc-600 dark:text-zinc-300">{LABELS[rowSym] ?? rowSym}</th>
                      {data.symbols.map((colSym, j) => {
                        const v = data.matrix[i][j]
                        return (
                          <td key={colSym} style={cellStyle(v)} className="rounded-lg p-3 font-mono font-bold text-zinc-900 dark:text-zinc-50">
                            {v.toFixed(2)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-zinc-400">
                {data.sample_size} paired 5-minute returns over the trailing {data.window_days} days · +1 = move
                together, −1 = move opposite, 0 = unrelated.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Plain-Language Read</p>
              <ul className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
                {pairs.map(p => (
                  <li key={`${p.a}-${p.b}`}>
                    <b>{LABELS[p.a] ?? p.a}</b> vs <b>{LABELS[p.b] ?? p.b}</b>: {p.v.toFixed(2)} —{' '}
                    {strengthLabel(p.v)} {p.v >= 0 ? 'correlation' : 'correlation'} over the trailing {days} days.
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-zinc-400">
                A high positive correlation between two instruments means their MTS Strategy signals are more
                likely to agree — taking both at once doesn&apos;t diversify risk as much as it might look like.
                A negative or near-zero correlation means they tend to move more independently.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

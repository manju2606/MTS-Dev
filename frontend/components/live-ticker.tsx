'use client'

import { useEffect, useRef, useState } from 'react'
import { createPriceStream } from '@/lib/api'
import type { PriceTick } from '@/lib/api'

interface Props {
  symbols: string[]
  token: string
}

export function LiveTicker({ symbols, token }: Props) {
  const [ticks, setTicks] = useState<Map<string, PriceTick>>(new Map())
  const [connected, setConnected] = useState(false)
  const streamRef = useRef<ReturnType<typeof createPriceStream> | null>(null)

  useEffect(() => {
    if (!symbols.length || !token) return

    const stream = createPriceStream(token, msg => {
      if (msg.type === 'subscribed') setConnected(true)
      if (msg.type === 'tick') {
        setTicks(prev => {
          const next = new Map(prev)
          msg.data.forEach(t => next.set(t.symbol, t))
          return next
        })
      }
    })

    streamRef.current = stream
    stream.subscribe(symbols)

    return () => { stream.close(); setConnected(false) }
  }, [symbols.join(','), token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!symbols.length) return null

  const tickList = symbols.map(s => ticks.get(s)).filter(Boolean) as PriceTick[]

  return (
    <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1.5 mr-3 shrink-0">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Live</span>
      </div>

      {tickList.length === 0 ? (
        <span className="text-xs text-zinc-400 animate-pulse">Connecting…</span>
      ) : (
        <div className="flex gap-4">
          {tickList.map(t => {
            if (!t.price) return null
            const up = t.change_pct >= 0
            return (
              <div key={t.symbol} className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  {t.symbol.replace(/\.(NS|BO)$/, '')}
                </span>
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-50">
                  ₹{t.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <span className={`text-[10px] font-semibold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {up ? '+' : ''}{t.change_pct.toFixed(2)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

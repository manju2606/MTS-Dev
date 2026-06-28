'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchStocks } from '@/lib/api'
import type { StockSearchResult } from '@/lib/api'

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
const ACTIVE = 'font-medium text-zinc-900 dark:text-zinc-50'

const nav: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Watchlist' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/market-pulse', label: 'Market Pulse' },
  { href: '/research', label: 'Research' },
  { href: '/ai', label: 'AI Analysis' },
  { href: '/ml', label: 'ML Signals' },
  { href: '/risk', label: 'Risk' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/paper', label: 'Paper Trading' },
  { href: '/live', label: 'Live Trading' },
  { href: '/broker', label: 'Broker' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/admin', label: 'Admin' },
]

function useDarkMode() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const saved = localStorage.getItem('mts_theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = saved ? saved === 'dark' : prefersDark
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mts_theme', next ? 'dark' : 'light')
  }

  return { dark, toggle }
}

function StockSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (query: string) => {
    const token = localStorage.getItem('mts_token') ?? ''
    if (!token || query.trim().length < 2) { setResults([]); setOpen(false); return }
    const r = await searchStocks(token, query).catch(() => [])
    setResults(r)
    setOpen(r.length > 0)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQ(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(v), 250)
  }

  function pick(r: StockSearchResult) {
    setQ('')
    setResults([])
    setOpen(false)
    router.push(`/dashboard?symbol=${encodeURIComponent(r.symbol)}`)
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        value={q}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search stocks…"
        className="w-40 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
      />
      {open && results.length > 0 && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.map(r => (
            <button
              key={r.symbol}
              onMouseDown={() => pick(r)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.name}</span>
                <span className="ml-2 text-xs text-zinc-400">{r.exchange}</span>
              </div>
              <span className="text-xs text-zinc-400">{r.sector}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function NavBar({ active }: { active: string }) {
  const router = useRouter()
  const { dark, toggle } = useDarkMode()

  function signOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
  }

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Manju Trade AI Pro
          </span>
          <nav className="flex items-center gap-4 overflow-x-auto text-xs">
            {nav.map(({ href, label }) => (
              <Link key={href} href={href} className={active === label ? ACTIVE : LINK}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StockSearch />
          <button
            onClick={toggle}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`rounded-lg px-2 py-1.5 text-xs ${LINK}`}
          >
            {dark ? '☀' : '☾'}
          </button>
          <Link href="/settings" className={`text-xs shrink-0 ${LINK}`}>Settings</Link>
          <button onClick={signOut} className={`text-xs shrink-0 ${LINK}`}>Sign out</button>
        </div>
      </div>
    </header>
  )
}

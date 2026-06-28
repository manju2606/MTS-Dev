'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchStocks } from '@/lib/api'
import type { StockSearchResult } from '@/lib/api'

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
const ACTIVE = 'font-medium text-zinc-900 dark:text-zinc-50'

const NAV: { href: string; label: string }[] = [
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
        className="w-36 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 sm:w-44"
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
  const [menuOpen, setMenuOpen] = useState(false)

  function signOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
  }

  return (
    <>
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          {/* Left: logo + desktop nav */}
          <div className="flex min-w-0 items-center gap-4">
            <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Manju Trade AI Pro
            </span>
            {/* Desktop nav — hidden on mobile */}
            <nav className="hidden items-center gap-4 overflow-x-auto text-xs md:flex">
              {NAV.map(({ href, label }) => (
                <Link key={href} href={href} className={active === label ? ACTIVE : LINK}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: search + dark mode + settings + sign out */}
          <div className="flex shrink-0 items-center gap-2">
            <StockSearch />
            <button
              onClick={toggle}
              title={dark ? 'Light mode' : 'Dark mode'}
              className={`hidden rounded-lg px-2 py-1.5 text-xs sm:block ${LINK}`}
            >
              {dark ? '☀' : '☾'}
            </button>
            <Link href="/settings" className={`hidden text-xs sm:block shrink-0 ${LINK}`}>
              Settings
            </Link>
            <button onClick={signOut} className={`hidden text-xs sm:block shrink-0 ${LINK}`}>
              Sign out
            </button>
            {/* Hamburger — shown on mobile only */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Open menu"
              className={`rounded-lg p-1.5 md:hidden ${LINK}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                {menuOpen
                  ? <path fillRule="evenodd" d="M3.293 3.293a1 1 0 011.414 0L9 7.586l4.293-4.293a1 1 0 111.414 1.414L10.414 9l4.293 4.293a1 1 0 01-1.414 1.414L9 10.414l-4.293 4.293a1 1 0 01-1.414-1.414L7.586 9 3.293 4.707a1 1 0 010-1.414z" />
                  : <>
                    <rect y="3" width="18" height="2" rx="1" />
                    <rect y="8" width="18" height="2" rx="1" />
                    <rect y="13" width="18" height="2" rx="1" />
                  </>
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="border-t border-zinc-100 bg-white px-4 pb-4 pt-2 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm ${active === label ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : LINK}`}
                >
                  {label}
                </Link>
              ))}
              <div className="mt-2 flex gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <button onClick={toggle} className={`text-sm ${LINK}`}>
                  {dark ? '☀ Light' : '☾ Dark'}
                </button>
                <Link href="/settings" className={`text-sm ${LINK}`}>Settings</Link>
                <button onClick={signOut} className={`text-sm ${LINK}`}>Sign out</button>
              </div>
            </nav>
          </div>
        )}
      </header>
    </>
  )
}

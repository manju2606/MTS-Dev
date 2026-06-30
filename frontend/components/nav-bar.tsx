'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addItemToWatchlist, searchStocks } from '@/lib/api'
import type { StockSearchResult } from '@/lib/api'

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
const ACTIVE = 'font-medium text-zinc-900 dark:text-zinc-50'

const NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
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
  { href: '/api-keys', label: 'API Keys' },
  { href: '/discovery', label: 'Discovery' },
  { href: '/reports', label: 'Reports' },
]

// ── Dark mode ────────────────────────────────────────────────────────────────

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

// ── Market hours ─────────────────────────────────────────────────────────────

type MarketState = 'open' | 'preopen' | 'closed'

function getMarketState(now: Date): { state: MarketState; nextChange: Date } {
  // IST = UTC + 5h30m
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000
  const ist = new Date(istMs)
  const day = ist.getUTCDay()   // 0=Sun 6=Sat in IST
  const h = ist.getUTCHours()
  const m = ist.getUTCMinutes()
  const mins = h * 60 + m

  const preOpenStart = 9 * 60          // 9:00
  const mainOpen = 9 * 60 + 15         // 9:15
  const mainClose = 15 * 60 + 30       // 15:30

  // Weekend
  if (day === 0 || day === 6) {
    // Next Monday 9:00 IST
    const daysUntilMon = day === 0 ? 1 : 2
    const nextMon = new Date(ist)
    nextMon.setUTCDate(ist.getUTCDate() + daysUntilMon)
    nextMon.setUTCHours(9 - 5, 60 - 30, 0, 0)   // 9:00 IST = 3:30 UTC
    return { state: 'closed', nextChange: new Date(nextMon.getTime()) }
  }

  if (mins < preOpenStart) {
    // Before pre-open: show closed, next = pre-open today
    const next = new Date(ist)
    next.setUTCHours(9 - 5, 60 - 30, 0, 0)
    return { state: 'closed', nextChange: new Date(next.getTime()) }
  }
  if (mins < mainOpen) {
    // Pre-open window
    const next = new Date(ist)
    next.setUTCHours(4, 15 - 30 + 60, 0, 0)  // 9:15 IST = 3:45 UTC
    next.setUTCHours(3, 45, 0, 0)
    return { state: 'preopen', nextChange: new Date(next.getTime()) }
  }
  if (mins < mainClose) {
    // Main session
    const next = new Date(ist)
    next.setUTCHours(10, 0, 0, 0)    // 15:30 IST = 10:00 UTC
    return { state: 'open', nextChange: new Date(next.getTime()) }
  }

  // After close: next open = tomorrow 9:00 (or Monday if Friday)
  const isFriday = day === 5
  const daysUntilNext = isFriday ? 3 : 1
  const next = new Date(ist)
  next.setUTCDate(ist.getUTCDate() + daysUntilNext)
  next.setUTCHours(3, 30, 0, 0)   // 9:00 IST = 3:30 UTC
  return { state: 'closed', nextChange: new Date(next.getTime()) }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function MarketHours() {
  const [info, setInfo] = useState<{ state: MarketState; countdown: string } | null>(null)

  useEffect(() => {
    function tick() {
      const now = new Date()
      const { state, nextChange } = getMarketState(now)
      const countdown = formatCountdown(nextChange.getTime() - now.getTime())
      setInfo({ state, countdown })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (!info) return null

  const dot = info.state === 'open'
    ? 'bg-emerald-500'
    : info.state === 'preopen'
      ? 'bg-amber-400'
      : 'bg-zinc-400'

  const label = info.state === 'open' ? 'NSE Open' : info.state === 'preopen' ? 'Pre-open' : 'NSE Closed'
  const next = info.state === 'open' ? `closes in ${info.countdown}` : `opens in ${info.countdown}`

  return (
    <div className="hidden items-center gap-1.5 lg:flex" title={next}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500">· {info.countdown}</span>
    </div>
  )
}

// ── Stock search with add-to-watchlist ───────────────────────────────────────

function StockSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
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

  async function addToWatchlist(e: React.MouseEvent, r: StockSearchResult) {
    e.stopPropagation()
    const token = localStorage.getItem('mts_token') ?? ''
    const watchlistId = localStorage.getItem('mts_active_watchlist_id') ?? ''
    if (!token || !watchlistId) return
    try {
      await addItemToWatchlist(token, watchlistId, r.symbol)
      setAdded(prev => ({ ...prev, [r.symbol]: true }))
      setTimeout(() => setAdded(prev => { const n = { ...prev }; delete n[r.symbol]; return n }), 2000)
    } catch {
      // already in watchlist or other error — silently ignore
    }
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
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.map(r => (
            <div key={r.symbol} className="flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <button
                onMouseDown={() => pick(r)}
                className="flex flex-1 items-center justify-between px-4 py-2.5 text-left"
              >
                <div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.name}</span>
                  <span className="ml-2 text-xs text-zinc-400">{r.exchange}</span>
                </div>
                <span className="text-xs text-zinc-400">{r.sector}</span>
              </button>
              <button
                onMouseDown={e => addToWatchlist(e, r)}
                title="Add to active watchlist"
                className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors"
                style={{
                  background: added[r.symbol] ? '#10b981' : '#6366f1',
                  color: 'white',
                }}
              >
                {added[r.symbol] ? '✓' : '+'}
              </button>
            </div>
          ))}
          <p className="border-t border-zinc-100 px-4 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
            Click name to view · + to add to active watchlist
          </p>
        </div>
      )}
    </div>
  )
}

// ── NavBar ────────────────────────────────────────────────────────────────────

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
            <nav className="hidden items-center gap-4 overflow-x-auto text-xs md:flex">
              {NAV.map(({ href, label }) => (
                <Link key={href} href={href} className={active === label ? ACTIVE : LINK}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: market hours + search + dark mode + settings + sign out */}
          <div className="flex shrink-0 items-center gap-2">
            <MarketHours />
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

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addItemToWatchlist, getMe, searchStocks } from '@/lib/api'
import type { StockSearchResult, User } from '@/lib/api'

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'

// ── Nav structure ─────────────────────────────────────────────────────────────

type NavItem  = { href: string; label: string; desc: string }
type NavGroup = {
  label: string
  roles: string[]
  href?:  string          // direct link (no dropdown)
  items?: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboard',
    href:  '/dashboard',
    roles: ['viewer', 'trader', 'admin'],
  },
  {
    label: 'Markets',
    roles: ['viewer', 'trader', 'admin'],
    items: [
      { href: '/market-pulse', label: 'Market Pulse',  desc: 'Live prices, indices & news' },
      { href: '/research',     label: 'Research',      desc: 'AI-powered stock screener' },
      { href: '/ai',           label: 'AI Analysis',   desc: 'Signal generation & history' },
      { href: '/ml',           label: 'ML Signals',    desc: 'Machine learning predictions' },
      { href: '/discovery',    label: 'Discovery',     desc: 'Stock discovery engine' },
      { href: '/reports',      label: 'Reports',       desc: 'Hourly scan email reports' },
    ],
  },
  {
    label: 'Trading',
    roles: ['trader', 'admin'],
    items: [
      { href: '/paper',    label: 'Paper Trading', desc: 'Simulated trades, zero risk' },
      { href: '/live',     label: 'Live Trading',  desc: 'Execute real orders' },
      { href: '/broker',   label: 'Broker',        desc: 'Zerodha / simulated setup' },
      { href: '/backtest', label: 'Backtest',      desc: 'Test strategies on history' },
      { href: '/alerts',   label: 'Alerts',        desc: 'Price & signal notifications' },
      { href: '/risk',     label: 'Risk',          desc: 'Position limits & kill switch' },
    ],
  },
  {
    label: 'Portfolio',
    href:  '/portfolio',
    roles: ['viewer', 'trader', 'admin'],
  },
  {
    label: 'Admin',
    roles: ['admin'],
    items: [
      { href: '/admin',    label: 'Admin',    desc: 'User management & system health' },
      { href: '/api-keys', label: 'API Keys', desc: 'Manage your API credentials' },
    ],
  },
]

// ── Dark mode ─────────────────────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const saved = localStorage.getItem('mts_theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = saved ? saved === 'dark' : prefersDark
    document.documentElement.classList.toggle('dark', isDark)
    const id = setTimeout(() => setDark(isDark), 0)
    return () => clearTimeout(id)
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mts_theme', next ? 'dark' : 'light')
  }

  return { dark, toggle }
}

// ── Market hours ──────────────────────────────────────────────────────────────

type MarketState = 'open' | 'preopen' | 'closed'

function getMarketState(now: Date): { state: MarketState; nextChange: Date } {
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000
  const ist   = new Date(istMs)
  const day   = ist.getUTCDay()
  const mins  = ist.getUTCHours() * 60 + ist.getUTCMinutes()

  const preOpenStart = 9 * 60
  const mainOpen     = 9 * 60 + 15
  const mainClose    = 15 * 60 + 30

  if (day === 0 || day === 6) {
    const daysUntilMon = day === 0 ? 1 : 2
    const nextMon = new Date(ist)
    nextMon.setUTCDate(ist.getUTCDate() + daysUntilMon)
    nextMon.setUTCHours(3, 30, 0, 0)
    return { state: 'closed', nextChange: new Date(nextMon.getTime()) }
  }
  if (mins < preOpenStart) {
    const next = new Date(ist); next.setUTCHours(3, 30, 0, 0)
    return { state: 'closed', nextChange: new Date(next.getTime()) }
  }
  if (mins < mainOpen) {
    const next = new Date(ist); next.setUTCHours(3, 45, 0, 0)
    return { state: 'preopen', nextChange: new Date(next.getTime()) }
  }
  if (mins < mainClose) {
    const next = new Date(ist); next.setUTCHours(10, 0, 0, 0)
    return { state: 'open', nextChange: new Date(next.getTime()) }
  }
  const isFriday = day === 5
  const next = new Date(ist)
  next.setUTCDate(ist.getUTCDate() + (isFriday ? 3 : 1))
  next.setUTCHours(3, 30, 0, 0)
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
      setInfo({ state, countdown: formatCountdown(nextChange.getTime() - now.getTime()) })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (!info) return null

  const dot   = info.state === 'open' ? 'bg-emerald-500' : info.state === 'preopen' ? 'bg-amber-400' : 'bg-zinc-400'
  const label = info.state === 'open' ? 'NSE Open' : info.state === 'preopen' ? 'Pre-open' : 'NSE Closed'
  const next  = info.state === 'open' ? `closes in ${info.countdown}` : `opens in ${info.countdown}`

  return (
    <div className="hidden items-center gap-1.5 lg:flex" title={next}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500">· {info.countdown}</span>
    </div>
  )
}

// ── Stock search ──────────────────────────────────────────────────────────────

function StockSearch() {
  const router = useRouter()
  const [q, setQ]           = useState('')
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [open, setOpen]     = useState(false)
  const [added, setAdded]   = useState<Record<string, boolean>>({})
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (query: string) => {
    const token = localStorage.getItem('mts_token') ?? ''
    if (!token || query.trim().length < 2) { setResults([]); setOpen(false); return }
    const r = await searchStocks(token, query).catch(() => [])
    setResults(r); setOpen(r.length > 0)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value; setQ(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(v), 250)
  }

  function pick(r: StockSearchResult) {
    setQ(''); setResults([]); setOpen(false)
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
    } catch { /* already in watchlist */ }
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
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
              <button onMouseDown={() => pick(r)} className="flex flex-1 items-center justify-between px-4 py-2.5 text-left">
                <div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.name}</span>
                  <span className="ml-2 text-xs text-zinc-400">{r.exchange}</span>
                </div>
                <span className="text-xs text-zinc-400">{r.sector}</span>
              </button>
              <button
                onMouseDown={e => addToWatchlist(e, r)}
                title="Add to active watchlist"
                className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white transition-colors"
                style={{ background: added[r.symbol] ? '#10b981' : '#6366f1' }}
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

// ── Dropdown group ────────────────────────────────────────────────────────────

function GroupDropdown({
  group, active, isOpen, onToggle, onClose,
}: {
  group: NavGroup
  active: string
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const isGroupActive = group.items?.some(i => i.label === active) ?? false

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
          isGroupActive
            ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
        }`}
      >
        {group.label}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M1.5 3.5L5 7l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && group.items && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {group.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex flex-col px-4 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                active === item.label ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''
              }`}
            >
              <span className={`text-xs font-medium ${active === item.label ? 'text-indigo-700 dark:text-indigo-300' : 'text-zinc-800 dark:text-zinc-200'}`}>
                {item.label}
              </span>
              <span className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">{item.desc}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── NavBar ────────────────────────────────────────────────────────────────────

export function NavBar({ active }: { active: string }) {
  const router   = useRouter()
  const { dark, toggle } = useDarkMode()
  const [menuOpen,  setMenuOpen]  = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) return
    getMe(t).then(setUser).catch(() => null)
  }, [])

  // Close dropdown when clicking outside the nav
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function signOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
  }

  const role   = user?.role ?? 'viewer'
  const groups = NAV_GROUPS.filter(g => g.roles.includes(role))

  const displayName = user ? (user.full_name.trim() || user.email.split('@')[0]) : null
  const roleLabel   = role === 'admin' ? 'Admin' : role === 'trader' ? 'Trader' : 'Viewer'

  return (
    <>
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">

          {/* Left: logo + desktop grouped nav */}
          <div ref={navRef} className="flex min-w-0 items-center gap-2">
            <Link href="/dashboard" className="mr-2 shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Manju Trade AI Pro
            </Link>

            <nav className="hidden items-center gap-1 text-xs md:flex">
              {groups.map(group => {
                // Direct link (no dropdown)
                if (group.href) {
                  return (
                    <Link
                      key={group.label}
                      href={group.href}
                      className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                        active === group.label
                          ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                      }`}
                    >
                      {group.label}
                    </Link>
                  )
                }

                // Dropdown group
                return (
                  <GroupDropdown
                    key={group.label}
                    group={group}
                    active={active}
                    isOpen={openGroup === group.label}
                    onToggle={() => setOpenGroup(o => o === group.label ? null : group.label)}
                    onClose={() => setOpenGroup(null)}
                  />
                )
              })}
            </nav>
          </div>

          {/* Right: market hours + search + user + dark mode + settings + sign out */}
          <div className="flex shrink-0 items-center gap-2">
            <MarketHours />
            <StockSearch />

            {displayName && (
              <div className="hidden items-center gap-1.5 sm:flex">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                  {displayName[0].toUpperCase()}
                </div>
                <div className="hidden flex-col lg:flex">
                  <span className="text-[11px] font-medium leading-none text-zinc-800 dark:text-zinc-200">{displayName}</span>
                  <span className="text-[10px] leading-none text-zinc-400">{roleLabel}</span>
                </div>
              </div>
            )}

            <button
              onClick={toggle}
              title={dark ? 'Light mode' : 'Dark mode'}
              className={`hidden rounded-lg px-2 py-1.5 text-xs sm:block ${LINK}`}
            >
              {dark ? '☀' : '☾'}
            </button>
            <Link href="/settings" className={`hidden text-xs sm:block shrink-0 ${LINK}`}>Settings</Link>
            <button onClick={signOut} className={`hidden text-xs sm:block shrink-0 ${LINK}`}>Sign out</button>

            {/* Hamburger */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Open menu"
              className={`rounded-lg p-1.5 md:hidden ${LINK}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                {menuOpen
                  ? <path fillRule="evenodd" d="M3.293 3.293a1 1 0 011.414 0L9 7.586l4.293-4.293a1 1 0 111.414 1.414L10.414 9l4.293 4.293a1 1 0 01-1.414 1.414L9 10.414l-4.293 4.293a1 1 0 01-1.414-1.414L7.586 9 3.293 4.707a1 1 0 010-1.414z" />
                  : <><rect y="3" width="18" height="2" rx="1" /><rect y="8" width="18" height="2" rx="1" /><rect y="13" width="18" height="2" rx="1" /></>
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="border-t border-zinc-100 bg-white px-4 pb-4 pt-2 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
            {displayName && (
              <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                  {displayName[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{displayName}</p>
                  <p className="text-xs text-zinc-400">{roleLabel}</p>
                </div>
              </div>
            )}

            <nav className="flex flex-col gap-1">
              {groups.map(group => {
                if (group.href) {
                  return (
                    <Link
                      key={group.label}
                      href={group.href}
                      onClick={() => setMenuOpen(false)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ${
                        active === group.label
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : LINK
                      }`}
                    >
                      {group.label}
                    </Link>
                  )
                }

                const isExpanded = mobileExpanded === group.label
                const isGroupActive = group.items?.some(i => i.label === active) ?? false

                return (
                  <div key={group.label}>
                    <button
                      onClick={() => setMobileExpanded(o => o === group.label ? null : group.label)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
                        isGroupActive
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : LINK
                      }`}
                    >
                      {group.label}
                      <svg
                        width="12" height="12" viewBox="0 0 10 10" fill="currentColor"
                        className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      >
                        <path d="M1.5 3.5L5 7l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {isExpanded && group.items && (
                      <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
                        {group.items.map(item => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMenuOpen(false)}
                            className={`rounded-lg px-2 py-1.5 text-sm ${
                              active === item.label
                                ? 'font-semibold text-indigo-700 dark:text-indigo-300'
                                : LINK
                            }`}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="mt-2 flex gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <button onClick={toggle} className={`text-sm ${LINK}`}>{dark ? '☀ Light' : '☾ Dark'}</button>
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

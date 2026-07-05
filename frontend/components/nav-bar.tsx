'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getMe, getUnreadCount } from '@/lib/api'
import type { User } from '@/lib/api'

// ── Icon primitives ───────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  // Group icons
  home:      'M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-5h-6v5H5a2 2 0 0 1-2-2z',
  barChart:  'M12 20V10M6 20V4M18 20v-4',
  zap:       'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  shield:    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  // Item icons
  activity:  'M22 12h-4l-3 9L9 3l-3 9H2',
  search:    'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
  sparkles:  'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z',
  cpu:       'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
  compass:   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.24 5.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
  fileText:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2z',
  link:      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  clock:     'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v5l3 3',
  bell:      'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  warning:   'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  users:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM23 21v-2a4 4 0 0 0-3-3.87',
  key:        'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  trendingUp: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  squares:   'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  star:      'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  database:  'M12 2C6.477 2 2 4.239 2 7v10c0 2.761 4.477 5 10 5s10-2.239 10-5V7c0-2.761-4.477-5-10-5zM2 12c0 2.761 4.477 5 10 5s10-2.239 10-5M2 7c0 2.761 4.477 5 10 5s10-2.239 10-5',
}

function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

// ── Nav structure ─────────────────────────────────────────────────────────────

type NavItem  = { href: string; label: string; desc: string; icon: string }
type NavGroup = {
  label: string
  icon:  string
  roles: string[]
  href?:  string
  items?: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboard',
    icon:  'home',
    href:  '/dashboard',
    roles: ['viewer', 'trader', 'admin'],
  },
  {
    label: 'Markets',
    icon:  'barChart',
    roles: ['viewer', 'trader', 'admin'],
    items: [
      { href: '/market-pulse', label: 'Market Pulse',  icon: 'activity',  desc: 'Live prices, indices & news' },
      { href: '/scanner',      label: 'Scanner',       icon: 'search',    desc: '16 technical & institutional scans' },
      { href: '/research',     label: 'Research',      icon: 'cpu',       desc: 'AI-powered stock screener' },
      { href: '/ai',           label: 'AI Analysis',   icon: 'sparkles',  desc: 'Signal generation & history' },
      { href: '/ml',           label: 'ML Signals',    icon: 'cpu',       desc: 'Machine learning predictions' },
      { href: '/discovery',    label: 'Discovery',     icon: 'compass',     desc: 'Stock discovery engine' },
      { href: '/heatmap',      label: 'Heat Map',      icon: 'squares',    desc: 'NSE-style market heat map' },
      { href: '/forecast',      label: 'Forecast',       icon: 'trendingUp', desc: 'ML price predictions: day, week, month' },
      { href: '/stock-of-day',    label: 'Stock of Day',   icon: 'star',     desc: 'AI top pick · auto paper trade · SL/target tracking' },
      { href: '/reports',        label: 'Reports',        icon: 'fileText', desc: 'Hourly scan email reports' },
    ],
  },
  {
    label: 'Trading',
    icon:  'zap',
    roles: ['trader', 'admin'],
    items: [
      { href: '/watchlists', label: 'Watchlists',       icon: 'list',       desc: 'Track stocks with live quotes' },
      { href: '/paper',      label: 'Paper Trading',    icon: 'clipboard',  desc: 'Simulated trades, zero risk' },
      { href: '/live',       label: 'Live Trading',     icon: 'zap',        desc: 'Execute real orders' },
      { href: '/broker',     label: 'Broker',           icon: 'link',       desc: 'Zerodha / simulated setup' },
      { href: '/backtest',   label: 'Backtest',         icon: 'clock',      desc: 'Test strategies on history' },
      { href: '/strategy',   label: 'Strategy Builder', icon: 'trendingUp', desc: 'Rules-based strategies + backtest' },
      { href: '/alerts',     label: 'Alerts',           icon: 'bell',       desc: 'Price & signal notifications' },
      { href: '/webhooks',   label: 'Webhooks',         icon: 'link',       desc: 'HTTP event delivery to your endpoints' },
      { href: '/risk',       label: 'Risk',             icon: 'warning',    desc: 'Position limits & kill switch' },
    ],
  },
  {
    label: 'Portfolio',
    icon:  'briefcase',
    roles: ['viewer', 'trader', 'admin'],
    items: [
      { href: '/portfolio',           label: 'Paper Trading',        icon: 'clipboard',  desc: 'P&L and analysis of paper trades' },
      { href: '/portfolio/assistant', label: 'Portfolio Assistant',  icon: 'sparkles',   desc: 'Track real holdings · AI analysis · chat' },
      { href: '/tax',                 label: 'Tax Report',           icon: 'fileText',   desc: 'STCG / LTCG breakdown & CSV export' },
    ],
  },
  {
    label: 'Admin',
    icon:  'shield',
    roles: ['admin'],
    items: [
      { href: '/admin',          label: 'Admin',        icon: 'users',    desc: 'User management & system health' },
      { href: '/api-keys',       label: 'API Keys',     icon: 'key',      desc: 'Manage your API credentials' },
      { href: '/market-sources', label: 'Data Sources', icon: 'database', desc: 'Live source health & quote comparison' },
    ],
  },
]

// ── Dark mode ─────────────────────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const saved       = localStorage.getItem('mts_theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark      = saved ? saved === 'dark' : prefersDark
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

  if (day === 0 || day === 6) {
    const next = new Date(ist)
    next.setUTCDate(ist.getUTCDate() + (day === 0 ? 1 : 2))
    next.setUTCHours(3, 30, 0, 0)
    return { state: 'closed', nextChange: new Date(next.getTime()) }
  }
  if (mins < 540) {
    const next = new Date(ist); next.setUTCHours(3, 30, 0, 0)
    return { state: 'closed', nextChange: new Date(next.getTime()) }
  }
  if (mins < 555) {
    const next = new Date(ist); next.setUTCHours(3, 45, 0, 0)
    return { state: 'preopen', nextChange: new Date(next.getTime()) }
  }
  if (mins < 930) {
    const next = new Date(ist); next.setUTCHours(10, 0, 0, 0)
    return { state: 'open', nextChange: new Date(next.getTime()) }
  }
  const next = new Date(ist)
  next.setUTCDate(ist.getUTCDate() + (day === 5 ? 3 : 1))
  next.setUTCHours(3, 30, 0, 0)
  return { state: 'closed', nextChange: new Date(next.getTime()) }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s % 60}s`
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
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isGroupActive
            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
        }`}
      >
        <Icon name={group.icon} size={14} />
        {group.label}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          className={`opacity-60 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && group.items && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="px-2 py-2">
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  active === item.label ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  active === item.label
                    ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}>
                  <Icon name={item.icon} size={13} />
                </span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold leading-none ${
                    active === item.label
                      ? 'text-indigo-700 dark:text-indigo-300'
                      : 'text-zinc-800 dark:text-zinc-200'
                  }`}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] leading-none text-zinc-400 dark:text-zinc-500">
                    {item.desc}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── NavBar ────────────────────────────────────────────────────────────────────

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'

export function NavBar({ active }: { active: string }) {
  const router   = useRouter()
  const { dark, toggle } = useDarkMode()
  const [menuOpen,       setMenuOpen]       = useState(false)
  const [openGroup,      setOpenGroup]      = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) return
    getMe(t).then(setUser).catch(() => null)
  }, [])

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

  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) return
    let cancelled = false
    async function poll() {
      try {
        const n = await getUnreadCount(t!)
        if (!cancelled) setUnreadCount(n)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const role        = user?.role ?? 'viewer'
  const groups      = NAV_GROUPS.filter(g => g.roles.includes(role))
  const displayName = user ? (user.full_name.trim() || user.email.split('@')[0]) : null
  const roleLabel   = role === 'admin' ? 'Admin' : role === 'trader' ? 'Trader' : 'Viewer'

  return (
    <>
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">

          {/* Left: logo + desktop grouped nav */}
          <div ref={navRef} className="flex min-w-0 items-center gap-2">
            <Link href="/dashboard" className="mr-2 shrink-0 text-sm font-bold text-zinc-900 dark:text-zinc-50">
              MTS Pro
            </Link>

            <nav className="hidden items-center gap-0.5 md:flex">
              {groups.map(group => {
                if (group.href) {
                  const isActive = active === group.label
                  return (
                    <Link
                      key={group.label}
                      href={group.href}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Icon name={group.icon} size={14} />
                      {group.label}
                    </Link>
                  )
                }
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

          {/* Right */}
          <div className="flex shrink-0 items-center gap-2">
            <MarketHours />

            {displayName && (
              <div className="hidden items-center gap-2 sm:flex">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                  {displayName[0].toUpperCase()}
                </div>
                <div className="hidden flex-col lg:flex">
                  <span className="text-[11px] font-semibold leading-none text-zinc-800 dark:text-zinc-200">{displayName}</span>
                  <span className="mt-0.5 text-[10px] leading-none text-zinc-400">{roleLabel}</span>
                </div>
              </div>
            )}

            <Link
              href="/notifications"
              title="Notifications"
              className={`relative hidden rounded-lg p-1.5 sm:block ${LINK}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS['bell']} />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
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
              <div className="mb-3 flex items-center gap-2.5 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                  {displayName[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{displayName}</p>
                  <p className="text-xs text-zinc-400">{roleLabel}</p>
                </div>
              </div>
            )}

            <nav className="flex flex-col gap-0.5">
              {groups.map(group => {
                if (group.href) {
                  return (
                    <Link
                      key={group.label}
                      href={group.href}
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                        active === group.label
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : LINK
                      }`}
                    >
                      <Icon name={group.icon} size={15} />
                      {group.label}
                    </Link>
                  )
                }

                const isExpanded    = mobileExpanded === group.label
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
                      <span className="flex items-center gap-2.5">
                        <Icon name={group.icon} size={15} />
                        {group.label}
                      </span>
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                        className={`opacity-50 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    {isExpanded && group.items && (
                      <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
                        {group.items.map(item => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                              active === item.label
                                ? 'font-semibold text-indigo-700 dark:text-indigo-300'
                                : LINK
                            }`}
                          >
                            <Icon name={item.icon} size={13} />
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

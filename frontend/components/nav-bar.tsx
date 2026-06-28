'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

const LINK = 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
const ACTIVE = 'font-medium text-zinc-900 dark:text-zinc-50'

export function NavBar({ active }: { active: string }) {
  const router = useRouter()
  function signOut() {
    localStorage.removeItem('mts_token')
    router.replace('/login')
  }

  const nav: { href: string; label: string }[] = [
    { href: '/dashboard', label: 'Watchlist' },
    { href: '/market-pulse', label: 'Market Pulse' },
    { href: '/research', label: 'Research' },
    { href: '/ai', label: 'AI Analysis' },
    { href: '/ml', label: 'ML Signals' },
    { href: '/risk', label: 'Risk' },
    { href: '/backtest', label: 'Backtest' },
    { href: '/paper', label: 'Paper Trading' },
    { href: '/live', label: 'Live Trading' },
    { href: '/broker', label: 'Broker' },
    { href: '/admin', label: 'Admin' },
  ]

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Manju Trade AI Pro
          </span>
          <nav className="flex items-center gap-4 text-xs overflow-x-auto">
            {nav.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={active === label ? ACTIVE : LINK}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <button onClick={signOut} className={`text-xs shrink-0 ${LINK}`}>
          Sign out
        </button>
      </div>
    </header>
  )
}

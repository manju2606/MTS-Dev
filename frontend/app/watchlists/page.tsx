import { Suspense } from 'react'
import type { Metadata } from 'next'
import WatchlistView from './watchlist-view'

export const metadata: Metadata = {
  title: 'Watchlists — Manju Trade AI Pro',
}

export default function WatchlistsPage() {
  return (
    <Suspense>
      <WatchlistView />
    </Suspense>
  )
}

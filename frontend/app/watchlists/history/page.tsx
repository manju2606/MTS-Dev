import { Suspense } from 'react'
import type { Metadata } from 'next'
import WatchlistHistoryView from './watchlist-history-view'

export const metadata: Metadata = {
  title: 'Watchlist History — Manju Trade AI Pro',
}

export default function WatchlistHistoryPage() {
  return (
    <Suspense>
      <WatchlistHistoryView />
    </Suspense>
  )
}

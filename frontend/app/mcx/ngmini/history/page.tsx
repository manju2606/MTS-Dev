import type { Metadata } from 'next'
import { Suspense } from 'react'
import NgMiniHistoryView from './history-view'

export const metadata: Metadata = { title: 'NG Mini History — Manju Trade AI Pro' }

export default function NgMiniHistoryPage() {
  return (
    <Suspense>
      <NgMiniHistoryView />
    </Suspense>
  )
}

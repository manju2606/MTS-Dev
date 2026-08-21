import type { Metadata } from 'next'
import { Suspense } from 'react'
import Silver100HistoryView from './history-view'

export const metadata: Metadata = { title: 'Silver100 History — Manju Trade AI Pro' }

export default function Silver100HistoryPage() {
  return (
    <Suspense>
      <Silver100HistoryView />
    </Suspense>
  )
}

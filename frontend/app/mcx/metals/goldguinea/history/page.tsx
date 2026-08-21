import type { Metadata } from 'next'
import { Suspense } from 'react'
import GoldGuineaHistoryView from './history-view'

export const metadata: Metadata = { title: 'GoldGuinea History — Manju Trade AI Pro' }

export default function GoldGuineaHistoryPage() {
  return (
    <Suspense>
      <GoldGuineaHistoryView />
    </Suspense>
  )
}

import { Suspense } from 'react'
import type { Metadata } from 'next'
import LiveView from './live-view'

export const metadata: Metadata = { title: 'Live Trading — Manju Trade AI Pro' }

export default function LivePage() {
  return (
    <Suspense>
      <LiveView />
    </Suspense>
  )
}

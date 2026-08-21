import type { Metadata } from 'next'
import { Suspense } from 'react'
import McxCorrelationView from './correlation-view'

export const metadata: Metadata = { title: 'MCX Correlation — Manju Trade AI Pro' }

export default function McxCorrelationPage() {
  return (
    <Suspense>
      <McxCorrelationView />
    </Suspense>
  )
}

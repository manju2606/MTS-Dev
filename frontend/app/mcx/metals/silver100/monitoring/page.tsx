import type { Metadata } from 'next'
import { Suspense } from 'react'
import Silver100MonitoringView from './monitoring-view'

export const metadata: Metadata = { title: 'Silver100 Monitoring — Manju Trade AI Pro' }

export default function Silver100MonitoringPage() {
  return (
    <Suspense>
      <Silver100MonitoringView />
    </Suspense>
  )
}

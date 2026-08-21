import type { Metadata } from 'next'
import { Suspense } from 'react'
import GoldGuineaMonitoringView from './monitoring-view'

export const metadata: Metadata = { title: 'GoldGuinea Monitoring — Manju Trade AI Pro' }

export default function GoldGuineaMonitoringPage() {
  return (
    <Suspense>
      <GoldGuineaMonitoringView />
    </Suspense>
  )
}

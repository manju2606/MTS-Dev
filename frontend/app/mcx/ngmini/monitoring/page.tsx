import type { Metadata } from 'next'
import { Suspense } from 'react'
import NgMiniMonitoringView from './monitoring-view'

export const metadata: Metadata = { title: 'NG Mini Monitoring — Manju Trade AI Pro' }

export default function NgMiniMonitoringPage() {
  return (
    <Suspense>
      <NgMiniMonitoringView />
    </Suspense>
  )
}

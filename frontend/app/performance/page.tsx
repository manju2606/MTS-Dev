import type { Metadata } from 'next'
import { PerformanceView } from './performance-view'

export const metadata: Metadata = { title: 'Performance | MTS Pro' }

export default function PerformancePage() {
  return <PerformanceView />
}

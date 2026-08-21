import type { Metadata } from 'next'
import McxStrategyDashboardView from './mcx-strategy-dashboard-view'

export const metadata: Metadata = { title: 'MTS Strategy Dashboard — Manju Trade AI Pro' }

export default function McxStrategyDashboardPage() {
  return <McxStrategyDashboardView />
}

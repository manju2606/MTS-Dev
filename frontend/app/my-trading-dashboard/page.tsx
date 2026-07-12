import type { Metadata } from 'next'
import MyTradingDashboardView from './my-trading-dashboard-view'

export const metadata: Metadata = { title: 'My Trading Dashboard — Manju Trade AI Pro' }

export default function MyTradingDashboardPage() {
  return <MyTradingDashboardView />
}

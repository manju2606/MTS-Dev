import type { Metadata } from 'next'
import DashboardView from './dashboard-view'

export const metadata: Metadata = {
  title: 'Dashboard — Manju Trade AI Pro',
}

export default function DashboardPage() {
  return <DashboardView />
}

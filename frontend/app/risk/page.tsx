import type { Metadata } from 'next'
import RiskView from './risk-view'

export const metadata: Metadata = { title: 'Risk Engine — Manju Trade AI Pro' }

export default function RiskPage() {
  return <RiskView />
}

import type { Metadata } from 'next'
import { StockOfDayView } from './stock-of-day-view'

export const metadata: Metadata = { title: 'Stock of the Day | MTS Pro' }

export default function StockOfDayPage() {
  return <StockOfDayView />
}

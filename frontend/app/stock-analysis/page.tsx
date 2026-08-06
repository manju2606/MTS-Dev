import type { Metadata } from 'next'
import StockAnalysisView from './stock-analysis-view'

export const metadata: Metadata = { title: 'Stock Analysis — Manju Trade AI Pro' }

export default function StockAnalysisPage() {
  return <StockAnalysisView />
}

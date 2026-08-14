import type { Metadata } from 'next'
import { Suspense } from 'react'
import StockAnalysisView from './stock-analysis-view'

export const metadata: Metadata = { title: 'Stock Analysis — Manju Trade AI Pro' }

export default function StockAnalysisPage() {
  return (
    <Suspense>
      <StockAnalysisView />
    </Suspense>
  )
}

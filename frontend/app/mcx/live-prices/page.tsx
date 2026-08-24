import type { Metadata } from 'next'
import { Suspense } from 'react'
import McxLivePricesView from './live-prices-view'

export const metadata: Metadata = { title: 'MCX Live Prices — Manju Trade AI Pro' }

export default function McxLivePricesPage() {
  return (
    <Suspense>
      <McxLivePricesView />
    </Suspense>
  )
}

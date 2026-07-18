import type { Metadata } from 'next'
import { Suspense } from 'react'
import McxView from './mcx-view'

export const metadata: Metadata = { title: 'MCX Natural Gas — Manju Trade AI Pro' }

export default function McxPage() {
  return (
    <Suspense>
      <McxView />
    </Suspense>
  )
}

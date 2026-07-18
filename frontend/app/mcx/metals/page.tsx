import type { Metadata } from 'next'
import { Suspense } from 'react'
import McxMetalsView from './metals-view'

export const metadata: Metadata = { title: 'MCX Base & Precious Metals — Manju Trade AI Pro' }

export default function McxMetalsPage() {
  return (
    <Suspense>
      <McxMetalsView />
    </Suspense>
  )
}

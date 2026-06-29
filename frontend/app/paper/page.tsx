import { Suspense } from 'react'
import type { Metadata } from 'next'
import PaperView from './paper-view'

export const metadata: Metadata = {
  title: 'Paper Trading — Manju Trade AI Pro',
}

export default function PaperPage() {
  return (
    <Suspense>
      <PaperView />
    </Suspense>
  )
}

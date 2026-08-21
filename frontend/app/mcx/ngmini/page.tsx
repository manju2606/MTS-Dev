import type { Metadata } from 'next'
import { Suspense } from 'react'
import NgMiniView from './ngmini-view'

export const metadata: Metadata = { title: 'NG Mini Strategy — Manju Trade AI Pro' }

export default function NgMiniPage() {
  return (
    <Suspense>
      <NgMiniView />
    </Suspense>
  )
}

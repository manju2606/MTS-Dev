import type { Metadata } from 'next'
import { Suspense } from 'react'
import GoldenEggView from './golden-egg-view'

export const metadata: Metadata = { title: 'Golden Egg — Manju Trade AI Pro' }

export default function GoldenEggPage() {
  return (
    <Suspense>
      <GoldenEggView />
    </Suspense>
  )
}

import type { Metadata } from 'next'
import { Suspense } from 'react'
import Silver100View from './silver100-view'

export const metadata: Metadata = { title: 'Silver100 Strategy — Manju Trade AI Pro' }

export default function Silver100Page() {
  return (
    <Suspense>
      <Silver100View />
    </Suspense>
  )
}

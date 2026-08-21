import type { Metadata } from 'next'
import { Suspense } from 'react'
import GoldGuineaView from './goldguinea-view'

export const metadata: Metadata = { title: 'GoldGuinea Strategy — Manju Trade AI Pro' }

export default function GoldGuineaPage() {
  return (
    <Suspense>
      <GoldGuineaView />
    </Suspense>
  )
}

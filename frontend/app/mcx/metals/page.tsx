import type { Metadata } from 'next'
import McxMetalsView from './metals-view'

export const metadata: Metadata = { title: 'MCX Base & Precious Metals — Manju Trade AI Pro' }

export default function McxMetalsPage() {
  return <McxMetalsView />
}

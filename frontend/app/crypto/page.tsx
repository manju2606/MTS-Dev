import type { Metadata } from 'next'
import CryptoView from './crypto-view'

export const metadata: Metadata = { title: 'Crypto — Manju Trade AI Pro' }

export default function CryptoPage() {
  return <CryptoView />
}

import type { Metadata } from 'next'
import ApiKeysView from './api-keys-view'

export const metadata: Metadata = { title: 'API Keys — Manju Trade AI Pro' }

export default function ApiKeysPage() {
  return <ApiKeysView />
}

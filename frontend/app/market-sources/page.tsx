import type { Metadata } from 'next'
import { MarketSourcesView } from './market-sources-view'

export const metadata: Metadata = { title: 'Data Sources | MTS Pro' }

export default function MarketSourcesPage() {
  return <MarketSourcesView />
}

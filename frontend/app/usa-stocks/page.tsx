import type { Metadata } from 'next'
import UsaStocksView from './usa-stocks-view'

export const metadata: Metadata = { title: 'USA Stocks — Manju Trade AI Pro' }

export default function UsaStocksPage() {
  return <UsaStocksView />
}

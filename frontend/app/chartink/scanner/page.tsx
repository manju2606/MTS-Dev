import type { Metadata } from 'next'
import { ChartinkScannerView } from './scanner-view'

export const metadata: Metadata = { title: 'Chartink Scanner | MTS Pro' }

export default function ChartinkScannerPage() {
  return <ChartinkScannerView />
}

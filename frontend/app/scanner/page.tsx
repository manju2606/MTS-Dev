import type { Metadata } from 'next'
import { ScannerView } from './scanner-view'

export const metadata: Metadata = { title: 'Market Scanner | MTS Pro' }

export default function ScannerPage() {
  return <ScannerView />
}

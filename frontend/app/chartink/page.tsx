import type { Metadata } from 'next'
import { ChartinkView } from './chartink-view'

export const metadata: Metadata = { title: 'Chartink | MTS Pro' }

export default function ChartinkPage() {
  return <ChartinkView />
}

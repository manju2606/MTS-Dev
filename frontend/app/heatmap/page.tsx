import type { Metadata } from 'next'
import { HeatmapView } from './heatmap-view'

export const metadata: Metadata = { title: 'Market Heat Map | MTS Pro' }

export default function HeatmapPage() {
  return <HeatmapView />
}

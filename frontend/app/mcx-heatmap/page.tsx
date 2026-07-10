import type { Metadata } from 'next'
import McxHeatmapView from './mcx-heatmap-view'

export const metadata: Metadata = { title: 'MCX Heatmap — Manju Trade AI Pro' }

export default function McxHeatmapPage() {
  return <McxHeatmapView />
}

import type { Metadata } from 'next'
import { DswsView } from './dsws-view'

export const metadata: Metadata = { title: 'DSWS | MTS Pro' }

export default function DswsPage() {
  return <DswsView />
}

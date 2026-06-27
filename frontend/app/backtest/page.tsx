import type { Metadata } from 'next'
import BacktestView from './backtest-view'

export const metadata: Metadata = { title: 'Backtest — Manju Trade AI Pro' }

export default function BacktestPage() {
  return <BacktestView />
}
